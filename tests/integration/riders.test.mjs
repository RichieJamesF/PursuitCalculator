import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

async function createEvent(baseUrl, code) {
  const res = await fetch(`${baseUrl}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rider test event", code }),
  });
  return res.json();
}

describe("riders routes", () => {
  let ctx;
  beforeEach(async () => { ctx = await startTestServer(); });
  afterEach(async () => { await stopTestServer(ctx.server); });
  after(async () => { await closePool(); });

  test("POST /api/events/:code/riders adds a rider without needing a token (public sign-up)", async () => {
    await createEvent(ctx.baseUrl, "riders-add");
    const res = await fetch(`${ctx.baseUrl}/api/events/riders-add/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alex", w: 70, ftp: 250, pos: "road_drops", build: "medium" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, "Alex");
    assert.equal(body.w, 70);
    assert.equal(body.ftp, 250);
    assert.equal(body.strava, false);
  });

  test("POST /api/events/:code/riders rejects a missing name", async () => {
    await createEvent(ctx.baseUrl, "riders-noname");
    const res = await fetch(`${ctx.baseUrl}/api/events/riders-noname/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ w: 70, ftp: 250 }),
    });
    assert.equal(res.status, 400);
  });

  test("PATCH /api/riders/:id requires an organiser token", async () => {
    await createEvent(ctx.baseUrl, "riders-patch-auth");
    const addRes = await fetch(`${ctx.baseUrl}/api/events/riders-patch-auth/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bo" }),
    });
    const rider = await addRes.json();
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hacked" }),
    });
    assert.equal(res.status, 403);
  });

  test("PATCH /api/riders/:id updates rider fields with a valid token", async () => {
    const ev = await createEvent(ctx.baseUrl, "riders-patch");
    const addRes = await fetch(`${ctx.baseUrl}/api/events/riders-patch/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cam" }),
    });
    const rider = await addRes.json();
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
      body: JSON.stringify({ ftp: 300 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ftp, 300);
    assert.equal(body.name, "Cam");
  });

  test("DELETE /api/riders/:id removes the rider with a valid token", async () => {
    const ev = await createEvent(ctx.baseUrl, "riders-delete");
    const addRes = await fetch(`${ctx.baseUrl}/api/events/riders-delete/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dee" }),
    });
    const rider = await addRes.json();
    const res = await fetch(`${ctx.baseUrl}/api/riders/${rider.id}`, {
      method: "DELETE", headers: { "x-organiser-token": ev.organiserToken },
    });
    assert.equal(res.status, 200);
    const check = await fetch(`${ctx.baseUrl}/api/events/riders-delete`);
    const checkBody = await check.json();
    assert.equal(checkBody.riders.length, 0);
  });
});
