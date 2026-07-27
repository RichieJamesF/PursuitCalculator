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

  test("GET /auth/strava with a valid rider key verifies the signed state", async () => {
    process.env.STRAVA_CLIENT_ID = "test-client-id";
    process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
    try {
      const { rider } = await seed(ctx.baseUrl, "sv-ok");
      const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-ok&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
      assert.equal(res.status, 302);
      const location = res.headers.get("location");
      assert.ok(location, "Expected Location header");
      assert.ok(location.includes("state="), "Expected state parameter in Location");
      const stateMatch = location.match(/state=([^&]+)/);
      assert.ok(stateMatch, "Expected to extract state from Location");
      const decodedState = decodeURIComponent(stateMatch[1]);
      const payload = verifyState(decodedState);
      assert.ok(payload, "Expected state to verify");
      assert.equal(payload.code, "sv-ok");
      assert.equal(payload.rider, Number(rider.id));
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

      const state = signState({ code: "sv-dupe", rider: Number(claimant.id), ts: Date.now() });
      const res = await fetch(`${ctx.baseUrl}/auth/strava/callback?code=fakeauthcode&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location"), /stravaerror=1/);

      const after = await fetch(`${ctx.baseUrl}/api/events/sv-dupe`).then((r) => r.json());
      assert.equal(after.riders.find((r) => r.id === claimant.id).strava, false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreStrava();
    }
  });
});
