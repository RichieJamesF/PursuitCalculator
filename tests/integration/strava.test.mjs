import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";
import { q } from "../../db.js";
import { verifyState, signState } from "../../lib/strava.mjs";

const ORIGINAL_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

function restoreStrava() {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env.STRAVA_CLIENT_ID;
  } else {
    process.env.STRAVA_CLIENT_ID = ORIGINAL_CLIENT_ID;
  }
  if (ORIGINAL_CLIENT_SECRET === undefined) {
    delete process.env.STRAVA_CLIENT_SECRET;
  } else {
    process.env.STRAVA_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
  }
}

async function seed(baseUrl, code) {
  const ev = await fetch(`${baseUrl}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Strava auth", code }),
  }).then((r) => r.json());
  const rider = await fetch(`${baseUrl}/api/events/${code}/riders`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Ari" }),
  }).then((r) => r.json());
  return { ev, rider };
}

describe("strava routes", () => {
  let ctx;
  beforeEach(async () => { ctx = await startTestServer(); });
  afterEach(async () => { await stopTestServer(ctx.server); });
  after(async () => { await closePool(); });

  test("GET /auth/strava refuses a request with no key", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-nokey");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-nokey&rider=${rider.id}`, { redirect: "manual" });
    assert.equal(res.status, 400);
  });

  test("GET /auth/strava refuses an empty key", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-emptykey");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-emptykey&rider=${rider.id}&key=`, { redirect: "manual" });
    assert.equal(res.status, 400);
  });

  test("GET /auth/strava refuses a wrong key", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-badkey");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-badkey&rider=${rider.id}&key=nope`, { redirect: "manual" });
    assert.equal(res.status, 403);
  });

  test("GET /auth/strava refuses another rider's key", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-cross");
    const other = await fetch(`${ctx.baseUrl}/api/events/sv-cross/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bex" }),
    }).then((r) => r.json());
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-cross&rider=${rider.id}&key=${other.riderKey}`, { redirect: "manual" });
    assert.equal(res.status, 403);
  });

  test("GET /auth/strava 404s an unknown rider id", async () => {
    const { ev } = await seed(ctx.baseUrl, "sv-norider");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-norider&rider=999999&key=${ev.organiserToken}`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("GET /auth/strava 404s when code doesn't match the rider's event", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-mismatch");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=wrong-code&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("GET /auth/strava with a valid rider key renders a confirmation page naming the rider and event", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-ok");
      const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-ok&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Ari/); // the rider name — the entire security value of this page
      assert.match(html, /Strava auth/); // the event name
      assert.match(html, /<form method="post" action="\/auth\/strava">/);
      assert.match(html, new RegExp(`name="code" value="sv-ok"`));
      assert.match(html, new RegExp(`name="rider" value="${rider.id}"`));
      assert.match(html, new RegExp(`name="key" value="${rider.riderKey}"`));
      assert.match(html, /name="nonce" value="[0-9a-f]+"/);
      assert.match(html, /href="\/\?code=sv-ok"/); // cancel link
    } finally {
      restoreStrava();
    }
  });

  test("GET /auth/strava escapes a rider name with HTML-significant characters", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const ev = await fetch(`${ctx.baseUrl}/api/events`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Strava esc", code: "sv-esc" }),
      }).then((r) => r.json());
      const rider = await fetch(`${ctx.baseUrl}/api/events/sv-esc/riders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `<script>alert("hi")</script>` }),
      }).then((r) => r.json());
      const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-esc&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.doesNotMatch(html, /<script>alert/);
      assert.match(html, /&lt;script&gt;/);
    } finally {
      restoreStrava();
    }
  });

  test("GET /auth/strava refuses a rider key from a different event", async () => {
    const { rider: rider1 } = await seed(ctx.baseUrl, "sv-event1");
    const { rider: rider2 } = await seed(ctx.baseUrl, "sv-event2");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-event1&rider=${rider1.id}&key=${rider2.riderKey}`, { redirect: "manual" });
    assert.equal(res.status, 403);
  });

  test("GET /api/riders/:id/rides accepts an organiser token", async () => {
    const { rider, ev } = await seed(ctx.baseUrl, "sv-rides-org");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/rides`, {
      headers: { "x-organiser-token": ev.organiserToken },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hasn't linked Strava/);
  });

  test("GET /api/riders/:id/rides accepts a rider key and reports the unlinked state", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-rides");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/rides`, {
      headers: { "x-rider-token": rider.riderKey },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hasn't linked Strava/);
  });

  test("GET /api/riders/:id/rides rejects no token at all", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-rides-auth");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/rides`);
    assert.equal(res.status, 403);
  });

  test("POST /api/riders/:id/refine accepts an organiser token", async () => {
    const { rider, ev } = await seed(ctx.baseUrl, "sv-refine-org");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hasn't linked Strava/);
  });

  test("POST /api/riders/:id/refine accepts a rider key and reports the unlinked state", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-refine");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-rider-token": rider.riderKey },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hasn't linked Strava/);
  });

  test("DELETE /api/riders/:id/strava rejects with no auth", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-unlink-auth");
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/strava`, { method: "DELETE" });
    assert.equal(res.status, 403);
  });

  test("DELETE /api/riders/:id/strava clears the stored Strava columns", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-unlink");
    await q(
      "UPDATE riders SET strava_athlete_id=$1, strava_access_token=$2, strava_refresh_token=$3, strava_expires_at=$4 WHERE id=$5",
      [555555, "atok", "rtok", 9999999999, rider.id]
    );
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}/strava`, {
      method: "DELETE", headers: { "x-rider-token": rider.riderKey },
    });
    assert.equal(res.status, 200);
    const check = await fetch(`${ctx.baseUrl}/api/events/sv-unlink`).then((r) => r.json());
    assert.equal(check.riders[0].strava, false);
  });

  test("GET /auth/strava sets the nonce cookie with HttpOnly, SameSite=Lax, the expected path and Max-Age", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-cookie");
      const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-cookie&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(res.status, 200); // confirmation page, not a redirect to Strava
      const setCookie = res.headers.get("set-cookie");
      assert.ok(setCookie, "Expected a Set-Cookie header");
      assert.match(setCookie, /pursuit_oauth_nonce=/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Path=\/auth\/strava/i);
      assert.match(setCookie, /Max-Age=900/); // STATE_EXPIRY_MINUTES (15) * 60
      // The test server is plain HTTP (no BASE_URL override), so Secure must be conditional,
      // not unconditional — an unconditional Secure would silently drop the cookie here.
      assert.doesNotMatch(setCookie, /;\s*Secure/i);
    } finally {
      restoreStrava();
    }
  });

  test("GET /auth/strava sets Secure on the nonce cookie when the deployment is HTTPS", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = "https://pursuit.example";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-cookie-https");
      const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-cookie-https&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(res.status, 200);
      const setCookie = res.headers.get("set-cookie");
      assert.match(setCookie, /;\s*Secure/i);
    } finally {
      if (originalBaseUrl === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = originalBaseUrl;
      restoreStrava();
    }
  });

  test("callback with a valid signed state but no cookie is refused, signals the no-cookie case, and writes no token", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-nononce");
      const state = signState({ code: "sv-nononce", rider: Number(rider.id), ts: Date.now(), nonce: "somenonce123" });
      // No Cookie header at all — simulates a browser that never received (or blocked) it.
      const res = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location"), /stravaerror=nocookie/);
      const after = await fetch(`${ctx.baseUrl}/api/events/sv-nononce`).then((r) => r.json());
      assert.equal(after.riders.find((r) => r.id === rider.id).strava, false);
      const check = await q("SELECT strava_access_token FROM riders WHERE id=$1", [rider.id]);
      assert.equal(check.rows[0].strava_access_token, null);
    } finally {
      restoreStrava();
    }
  });

  test("callback with a valid signed state and a wrong cookie value is refused with the generic error and writes no token", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalFetch = globalThis.fetch;
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-wrongnonce");
      const state = signState({ code: "sv-wrongnonce", rider: Number(rider.id), ts: Date.now(), nonce: "correctnonce" });
      // Stub a *successful* token exchange, same as the "already linked" test below — if the
      // nonce compare were deleted, this stub would let the write through and the assertion
      // below would catch it. Unstubbed, this test would pass for the wrong reason: the real
      // fetch to strava.com would fail regardless of the nonce check, proving nothing.
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("/oauth/token")) {
          return { ok: true, json: async () => ({ athlete: { id: 111111 }, access_token: "shouldnotwrite", refresh_token: "rt", expires_at: 9999999999 }) };
        }
        return originalFetch(url, opts);
      };
      const res = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, {
        redirect: "manual", headers: { Cookie: "pursuit_oauth_nonce=wrongnonce" },
      });
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location"), /stravaerror=1/);
      assert.doesNotMatch(res.headers.get("location"), /nocookie/);
      const check = await q("SELECT strava_access_token FROM riders WHERE id=$1", [rider.id]);
      assert.equal(check.rows[0].strava_access_token, null);
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });

  test("callback with an old-format state carrying no nonce at all is refused, even with a cookie present", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalFetch = globalThis.fetch;
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-legacystate");
      const state = signState({ code: "sv-legacystate", rider: Number(rider.id), ts: Date.now() }); // no nonce field
      // Same stub as above — without it, an unguarded path would fail at the real Strava
      // call and this test would pass whether or not the nonce check exists.
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("/oauth/token")) {
          return { ok: true, json: async () => ({ athlete: { id: 222222 }, access_token: "shouldnotwrite", refresh_token: "rt", expires_at: 9999999999 }) };
        }
        return originalFetch(url, opts);
      };
      const res = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, {
        redirect: "manual", headers: { Cookie: "pursuit_oauth_nonce=anything" },
      });
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location"), /stravaerror/);
      const check = await q("SELECT strava_access_token FROM riders WHERE id=$1", [rider.id]);
      assert.equal(check.rows[0].strava_access_token, null);
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });

  test("callback refuses a Strava athlete already linked to a different rider in the same event", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalFetch = globalThis.fetch;
    try {
      const { rider: holder } = await seed(ctx.baseUrl, "sv-dupe");
      const claimant = await fetch(`${ctx.baseUrl}/api/events/sv-dupe/riders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bex" }),
      }).then((r) => r.json());
      await q("UPDATE riders SET strava_athlete_id=$1 WHERE id=$2", [777, holder.id]);

      // Stub only the Strava token exchange; everything else (including the local test
      // server request below) goes through the real fetch.
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("/oauth/token")) {
          return { ok: true, json: async () => ({ athlete: { id: 777 }, access_token: "tok", refresh_token: "reftok", expires_at: 9999999999 }) };
        }
        return originalFetch(url, opts);
      };

      // Must carry a matching nonce/cookie pair — the nonce check runs before exchange()
      // and would otherwise refuse this before ever reaching the dupe-detection logic.
      const state = signState({ code: "sv-dupe", rider: Number(claimant.id), ts: Date.now(), nonce: "matching-nonce" });
      const res = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, {
        redirect: "manual", headers: { Cookie: "pursuit_oauth_nonce=matching-nonce" },
      });
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location"), /stravaerror=1/);

      const after = await fetch(`${ctx.baseUrl}/api/events/sv-dupe`).then((r) => r.json());
      assert.equal(after.riders.find((r) => r.id === claimant.id).strava, false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });

  // Nothing anywhere else asserts a *successful* link (grep confirms "stravalinked" only
  // appears in routes/strava.js and public/state.js) — a nonce check that rejected valid
  // pairs would break every rider's ability to link Strava with the rest of this suite
  // still green. This walks the real flow end to end: confirm page -> POST -> callback.
  test("full flow: confirm page, POST with matching nonce, callback writes the token and redirects with stravalinked=1", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalFetch = globalThis.fetch;
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-happy");

      // Step 1: GET the confirmation page — extract the nonce it embedded in the form
      // and the nonce it set as a cookie. They must be the same value.
      const confirmRes = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-happy&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(confirmRes.status, 200);
      const html = await confirmRes.text();
      const formNonceMatch = html.match(/name="nonce" value="([^"]+)"/);
      assert.ok(formNonceMatch, "expected a nonce hidden field on the confirmation page");
      const formNonce = formNonceMatch[1];
      const setCookie = confirmRes.headers.get("set-cookie");
      assert.ok(setCookie, "expected a Set-Cookie header on the confirmation page");
      const cookieMatch = setCookie.match(/pursuit_oauth_nonce=([^;]+)/);
      assert.ok(cookieMatch, "expected the nonce cookie in Set-Cookie");
      const cookieNonce = cookieMatch[1];
      assert.equal(formNonce, cookieNonce);

      // Step 2: POST the form back with both the form nonce and the matching cookie.
      const postRes = await fetch(`${ctx.baseUrl}/auth/strava`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
        body: new URLSearchParams({ code: "sv-happy", rider: String(rider.id), key: rider.riderKey, nonce: formNonce }).toString(),
      });
      assert.equal(postRes.status, 302);
      const location = postRes.headers.get("location");
      assert.ok(location && location.includes("state="), "expected the POST to redirect to Strava with a signed state");
      const state = decodeURIComponent(location.match(/state=([^&]+)/)[1]);
      const payload = verifyState(state);
      assert.ok(payload, "expected the POST-minted state to verify");
      assert.equal(payload.code, "sv-happy");
      assert.equal(payload.rider, Number(rider.id));
      assert.equal(payload.nonce, cookieNonce);

      // Step 3: stub a successful token exchange and hit the callback with the real
      // state from step 2 and the same cookie — this is the genuine round-trip.
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("/oauth/token")) {
          return { ok: true, json: async () => ({ athlete: { id: 42424242 }, access_token: "happy-access-token", refresh_token: "happy-refresh-token", expires_at: 9999999999 }) };
        }
        return originalFetch(url, opts);
      };
      const cbRes = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, {
        redirect: "manual", headers: { Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
      });
      assert.equal(cbRes.status, 302);
      assert.match(cbRes.headers.get("location"), /stravalinked=1/);
      const check = await q("SELECT strava_access_token FROM riders WHERE id=$1", [rider.id]);
      assert.equal(check.rows[0].strava_access_token, "happy-access-token");
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });

  test("POST /auth/strava rejects a mismatched double-submit nonce (form vs cookie) and never redirects to Strava", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-postmismatch");
      const res = await fetch(`${ctx.baseUrl}/auth/strava`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: "pursuit_oauth_nonce=cookievalue" },
        body: new URLSearchParams({ code: "sv-postmismatch", rider: String(rider.id), key: rider.riderKey, nonce: "differentvalue" }).toString(),
      });
      assert.equal(res.status, 403);
    } finally {
      restoreStrava();
    }
  });

  test("POST /auth/strava rejects a missing nonce cookie even with a matching form nonce", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-postnocookie");
      const res = await fetch(`${ctx.baseUrl}/auth/strava`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, // no Cookie header at all
        body: new URLSearchParams({ code: "sv-postnocookie", rider: String(rider.id), key: rider.riderKey, nonce: "somevalue" }).toString(),
      });
      assert.equal(res.status, 403);
    } finally {
      restoreStrava();
    }
  });

  test("POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403)", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-postbadkey");
    // Cookie and form nonce match, so a nonce-check-only path would sail through (302) —
    // the only thing that can 403 here is checkStravaAuth's own key check. Asserting the
    // body text pins it to that specific check rather than any 403.
    const cookieNonce = "matching-nonce-for-badkey-test";
    const res = await fetch(`${ctx.baseUrl}/auth/strava`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
      body: new URLSearchParams({ code: "sv-postbadkey", rider: String(rider.id), key: "nope", nonce: cookieNonce }).toString(),
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /That key doesn't grant access to this rider\./);
  });

  // Same round-trip as the happy-path test above, but with the organiser's key instead of
  // the rider's own — an organiser linking a rider's Strava from the rider list is the
  // other legitimate caller of this route and shares the exact same checkStravaAuth() path.
  test("full flow with an organiser key: confirm page, POST, callback writes the token", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    const originalFetch = globalThis.fetch;
    try {
      const { rider, ev } = await seed(ctx.baseUrl, "sv-happy-org");

      const confirmRes = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-happy-org&rider=${rider.id}&key=${ev.organiserToken}`, { redirect: "manual" });
      assert.equal(confirmRes.status, 200);
      const html = await confirmRes.text();
      const formNonce = html.match(/name="nonce" value="([^"]+)"/)[1];
      const cookieNonce = confirmRes.headers.get("set-cookie").match(/pursuit_oauth_nonce=([^;]+)/)[1];

      const postRes = await fetch(`${ctx.baseUrl}/auth/strava`, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
        body: new URLSearchParams({ code: "sv-happy-org", rider: String(rider.id), key: ev.organiserToken, nonce: formNonce }).toString(),
      });
      assert.equal(postRes.status, 302);
      const state = decodeURIComponent(postRes.headers.get("location").match(/state=([^&]+)/)[1]);

      globalThis.fetch = async (url, opts) => {
        if (String(url).includes("/oauth/token")) {
          return { ok: true, json: async () => ({ athlete: { id: 55555555 }, access_token: "org-linked-token", refresh_token: "org-refresh", expires_at: 9999999999 }) };
        }
        return originalFetch(url, opts);
      };
      const cbRes = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, {
        redirect: "manual", headers: { Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
      });
      assert.equal(cbRes.status, 302);
      assert.match(cbRes.headers.get("location"), /stravalinked=1/);
      const check = await q("SELECT strava_access_token FROM riders WHERE id=$1", [rider.id]);
      assert.equal(check.rows[0].strava_access_token, "org-linked-token");
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });
});
