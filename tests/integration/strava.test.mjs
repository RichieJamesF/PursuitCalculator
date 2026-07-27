import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

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

  test("GET /auth/strava with a valid rider key gets past the auth check", async () => {
    const { rider } = await seed(ctx.baseUrl, "sv-ok");
    const res = await fetch(`${ctx.baseUrl}/auth/strava?code=sv-ok&rider=${rider.id}&key=${rider.riderKey}`, { redirect: "manual" });
    // Assert only that auth did NOT reject it. Where it lands next depends on the
    // environment: a 500 config guard with no STRAVA_CLIENT_ID set, or a 302 to Strava
    // if the developer happens to have one exported. Both mean the key was accepted.
    assert.ok(![400, 403, 404].includes(res.status), `expected auth to pass, got ${res.status}`);
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
});
