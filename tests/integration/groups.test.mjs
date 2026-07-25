import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

// Note: "/suggest requires a course first" isn't tested — POST /api/events always assigns
// a default course, so that guard is currently unreachable via the public API (pre-existing
// behavior, not introduced by this refactor).

async function createEventWithCourse(baseUrl, code) {
  const create = await fetch(`${baseUrl}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Groups test event", code }),
  });
  const ev = await create.json();
  await fetch(`${baseUrl}/api/events/${code}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
    body: JSON.stringify({ courseManual: { km: 20, ascent: 100 } }),
  });
  return ev;
}

async function addRider(baseUrl, code, ftp) {
  const res = await fetch(`${baseUrl}/api/events/${code}/riders`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Rider ${ftp}`, w: 70, ftp }),
  });
  return res.json();
}

describe("groups routes", () => {
  let ctx;
  beforeEach(async () => { ctx = await startTestServer(); });
  afterEach(async () => { await stopTestServer(ctx.server); });
  after(async () => { await closePool(); });

  test("POST /api/events/:code/suggest groups riders and returns a start sheet", async () => {
    const ev = await createEventWithCourse(ctx.baseUrl, "suggest-test");
    await addRider(ctx.baseUrl, "suggest-test", 150);
    await addRider(ctx.baseUrl, "suggest-test", 160);
    await addRider(ctx.baseUrl, "suggest-test", 300);
    await addRider(ctx.baseUrl, "suggest-test", 310);
    const res = await fetch(`${ctx.baseUrl}/api/events/suggest-test/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
      body: JSON.stringify({ size: 2 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.groups.length, 2);
    assert.equal(body.groups[0].members.length, 2);
    assert.equal(body.groups[1].members.length, 2);
    assert.equal(body.sheet.rows.length, 2);
  });

  test("PUT /api/events/:code/groups saves a manual arrangement", async () => {
    const ev = await createEventWithCourse(ctx.baseUrl, "groups-put");
    const a = await addRider(ctx.baseUrl, "groups-put", 200);
    const b = await addRider(ctx.baseUrl, "groups-put", 210);
    const res = await fetch(`${ctx.baseUrl}/api/events/groups-put/groups`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
      body: JSON.stringify({ groups: [{ id: "g1", members: [a.id, b.id], locked: false }] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.groups.length, 1);
    assert.deepEqual(body.groups[0].members.slice().sort(), [a.id, b.id].sort());
  });

  test("PUT /api/events/:code/groups requires an organiser token", async () => {
    await createEventWithCourse(ctx.baseUrl, "groups-put-auth");
    const res = await fetch(`${ctx.baseUrl}/api/events/groups-put-auth/groups`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groups: [] }),
    });
    assert.equal(res.status, 403);
  });
});
