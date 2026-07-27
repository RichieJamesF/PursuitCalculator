import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

describe("events routes", () => {
  let ctx;
  beforeEach(async () => { ctx = await startTestServer(); });
  afterEach(async () => { await stopTestServer(ctx.server); });
  after(async () => { await closePool(); });

  test("POST /api/events creates an event and returns an organiser token", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Pursuit" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.event.name, "Test Pursuit");
    assert.match(body.event.code, /^ride-[a-f0-9]{6}$/);
    assert.ok(body.organiserToken);
    assert.deepEqual(body.riders, []);
  });

  test("POST /api/events with a duplicate custom code returns 409", async () => {
    await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "First", code: "dupe-test" }),
    });
    const res = await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Second", code: "dupe-test" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "That event code is taken — pick another.");
  });

  test("GET /api/events/:code returns 404 for an unknown code", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/events/does-not-exist`);
    assert.equal(res.status, 404);
  });

  test("GET /api/events/:code returns the created event", async () => {
    await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fetchable", code: "fetch-test" }),
    });
    const res = await fetch(`${ctx.baseUrl}/api/events/fetch-test`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.event.code, "fetch-test");
    assert.equal(body.event.groupSize, 2);
    assert.equal(body.event.firstStart, "09:30");
  });

  test("PATCH /api/events/:code without an organiser token returns 403", async () => {
    await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Protected", code: "auth-test" }),
    });
    const res = await fetch(`${ctx.baseUrl}/api/events/auth-test`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hacked" }),
    });
    assert.equal(res.status, 403);
  });

  test("PATCH /api/events/:code with a valid organiser token updates the event", async () => {
    const create = await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Editable", code: "edit-test" }),
    });
    const { organiserToken } = await create.json();
    const res = await fetch(`${ctx.baseUrl}/api/events/edit-test`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-organiser-token": organiserToken },
      body: JSON.stringify({ name: "Renamed", groupSize: 3 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.event.name, "Renamed");
    assert.equal(body.event.groupSize, 3);
  });
});
