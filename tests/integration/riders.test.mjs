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

  test("POST /api/events/:code/riders returns a rider key once, and never leaks it again", async () => {
    await createEvent(ctx.baseUrl, "riders-key");
    const signup = await fetch(`${ctx.baseUrl}/api/events/riders-key/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kit" }),
    }).then((r) => r.json());

    assert.match(signup.riderKey, /^[a-f0-9]{32}$/);

    const listed = await fetch(`${ctx.baseUrl}/api/events/riders-key`).then((r) => r.json());
    assert.equal(listed.riders.length, 1);
    assert.equal(listed.riders[0].riderKey, undefined);
    assert.equal(listed.riders[0].rider_token, undefined);
  });

  test("two riders in the same event get different rider keys", async () => {
    await createEvent(ctx.baseUrl, "riders-key2");
    const add = (name) => fetch(`${ctx.baseUrl}/api/events/riders-key2/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    const a = await add("Ann"), b = await add("Bea");
    assert.notEqual(a.riderKey, b.riderKey);
  });

  test("a rider can PATCH their own row with their rider key", async () => {
    await createEvent(ctx.baseUrl, "riders-self");
    const me = await fetch(`${ctx.baseUrl}/api/events/riders-self/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sam", ftp: 240 }),
    }).then((r) => r.json());

    const res = await fetch(`${ctx.baseUrl}/api/riders/${me.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-rider-token": me.riderKey },
      body: JSON.stringify({ ftp: 265, w: 72 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ftp, 265);
    assert.equal(body.w, 72);
    assert.equal(body.name, "Sam");
  });

  test("a rider key cannot edit a different rider", async () => {
    await createEvent(ctx.baseUrl, "riders-cross");
    const add = (name) => fetch(`${ctx.baseUrl}/api/events/riders-cross/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    const a = await add("Ann"), b = await add("Bea");

    const res = await fetch(`${ctx.baseUrl}/api/riders/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-rider-token": a.riderKey },
      body: JSON.stringify({ name: "Hacked" }),
    });
    assert.equal(res.status, 403);
  });

  test("a rider can remove themselves with their rider key", async () => {
    await createEvent(ctx.baseUrl, "riders-selfdel");
    const me = await fetch(`${ctx.baseUrl}/api/events/riders-selfdel/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Gone" }),
    }).then((r) => r.json());

    const res = await fetch(`${ctx.baseUrl}/api/riders/${me.id}`, {
      method: "DELETE", headers: { "x-rider-token": me.riderKey },
    });
    assert.equal(res.status, 200);
    const check = await fetch(`${ctx.baseUrl}/api/events/riders-selfdel`).then((r) => r.json());
    assert.equal(check.riders.length, 0);
  });

  test("PATCH /api/riders/:id with a non-numeric id 404s with a sensible message", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/riders/not-an-id`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-rider-token": "whatever" },
      body: JSON.stringify({ name: "x" }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "No such rider.");
  });

  test("PATCH /api/riders/:id with an out-of-int4-range id 404s instead of erroring", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/riders/99999999999999999999`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-rider-token": "whatever" },
      body: JSON.stringify({ name: "x" }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "No such rider.");
  });
});
