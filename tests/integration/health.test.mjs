import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

after(async () => { await closePool(); });

test("GET /api/health responds ok over a real HTTP request against a real Postgres", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await stopTestServer(server);
  }
});
