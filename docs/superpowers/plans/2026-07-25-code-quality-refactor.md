# Code-Quality Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden and reorganize the Pursuit Calculator codebase (reliable async error handling, no duplication/dead code, navigable file layout, automated test coverage) without changing any behavior, API shape, DB schema, or UI interaction.

**Architecture:** Mechanical, behavior-preserving extraction. Existing logic moves into focused files (Express routers by resource on the backend, feature modules on the frontend) behind an automated test safety net that's written *before* the risky extractions happen. Backend split first (with integration tests against a real Postgres in Docker), then frontend split (with unit tests on the pure logic pieces).

**Tech Stack:** Node.js ≥18 (project already requires this), Express 4, `pg`, native ES modules (browser + Node), Node's built-in `node:test` + `node:assert/strict` test runner, Docker Compose for a disposable test Postgres.

## Global Constraints

- No new runtime dependencies. `package.json` keeps exactly `express` and `pg`.
- No new dev dependencies either — the test runner is Node's built-in `node:test`.
- No frontend build step. All frontend modules use native `<script type="module">` / `import`/`export`, served as static files exactly as today.
- No behavior changes: every route path, response JSON shape, DB schema, and UI interaction must be identical after this refactor.
- `node --test <dir>` does **not** reliably discover test files when given a bare directory path on this Node version/platform (verified: it tries to `require()` the directory name and fails) — always invoke it with an explicit glob, e.g. `node --test tests/unit/*.test.mjs`.
- Windows/PowerShell is the dev environment. Avoid bash-only syntax (`VAR=val cmd`, `&&`-chained env exports) in any script that npm or a developer might run directly; use Node scripts for anything that needs to set env vars or orchestrate multiple commands.

---

## Task 1: Unit test tooling + `lib/engine.mjs` tests

**Files:**
- Create: `tests/unit/engine.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `lib/engine.mjs` exports — `cdaOf`, `buildManualCourse`, `evenness`, `suggestGroups`, `computeSheet`, `calibrationFactor`, `soloDuration`, `DEFAULT_PARAMS` (all already exist, unchanged).
- Produces: the `tests/unit/` directory and the `npm test` command, which every later task's test files rely on.

- [ ] **Step 1: Add the `test` script to `package.json`**

Modify `package.json` — replace:

```json
  "scripts": { "start": "node server.js" },
```

with:

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/unit/*.test.mjs"
  },
```

- [ ] **Step 2: Write the test file**

Create `tests/unit/engine.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet,
  calibrationFactor, soloDuration, evenness, cdaOf,
} from "../../lib/engine.mjs";

const p = DEFAULT_PARAMS;

test("cdaOf combines position drag and build multiplier", () => {
  assert.equal(cdaOf({ pos: "road_drops", build: "medium" }), 0.32);
  assert.equal(cdaOf({ pos: "tt", build: "small" }), 0.216);
});

test("buildManualCourse returns a single flat segment when ascent is negligible", () => {
  const c = buildManualCourse(45, 0);
  assert.deepEqual(c, {
    segments: [{ dist: 45000, grad: 0 }],
    distanceM: 45000, ascentM: 0, name: "Manual course",
  });
});

test("buildManualCourse builds a climb/flat/descent profile for a real ascent", () => {
  const c = buildManualCourse(45, 500);
  assert.deepEqual(c.segments, [
    { dist: 10000, grad: 0.05 },
    { dist: 25000, grad: 0 },
    { dist: 10000, grad: -0.05 },
  ]);
  assert.equal(c.distanceM, 45000);
  assert.equal(c.ascentM, 500);
});

test("buildManualCourse treats sub-1m ascent as flat", () => {
  const c = buildManualCourse(45, 0.5);
  assert.deepEqual(c.segments, [{ dist: 45000, grad: 0 }]);
  assert.equal(c.ascentM, 0);
});

test("evenness labels front-share distributions", () => {
  assert.equal(evenness([1]), "Solo");
  assert.equal(evenness([0.5, 0.5]), "Even");
  assert.equal(evenness([0.7, 0.3]), "Fair");
  assert.equal(evenness([1, 0]), "Uneven");
});

test("suggestGroups chunks riders slowest-first into groups of the given size, with a trailing leftover", () => {
  const course = buildManualCourse(20, 200);
  const riders = {
    a: { id: "a", name: "A", w: 70, ftp: 100, pos: "road_drops", build: "medium", calib: 1 },
    b: { id: "b", name: "B", w: 70, ftp: 200, pos: "road_drops", build: "medium", calib: 1 },
    c: { id: "c", name: "C", w: 70, ftp: 300, pos: "road_drops", build: "medium", calib: 1 },
    d: { id: "d", name: "D", w: 70, ftp: 400, pos: "road_drops", build: "medium", calib: 1 },
    e: { id: "e", name: "E", w: 70, ftp: 500, pos: "road_drops", build: "medium", calib: 1 },
  };
  const { groups, leftover } = suggestGroups(["a", "b", "c", "d", "e"], riders, course.segments, p, 2);
  assert.deepEqual(groups, [["a", "b"], ["c", "d"]]);
  assert.deepEqual(leftover, ["e"]);
});

test("computeSheet seeds the slower group first (offset 0) and orders by offset", () => {
  const course = buildManualCourse(20, 200);
  const riders = {
    a: { id: "a", name: "A", w: 70, ftp: 100, pos: "road_drops", build: "medium", calib: 1 },
    b: { id: "b", name: "B", w: 70, ftp: 200, pos: "road_drops", build: "medium", calib: 1 },
    c: { id: "c", name: "C", w: 70, ftp: 300, pos: "road_drops", build: "medium", calib: 1 },
    d: { id: "d", name: "D", w: 70, ftp: 400, pos: "road_drops", build: "medium", calib: 1 },
  };
  const sheet = computeSheet(
    [{ id: "g1", members: ["a", "b"], locked: false }, { id: "g2", members: ["c", "d"], locked: false }],
    riders, course.segments, p
  );
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0].gid, "g1");
  assert.equal(sheet.rows[0].seed, 1);
  assert.equal(sheet.rows[0].offset, 0);
  assert.equal(sheet.rows[1].gid, "g2");
  assert.equal(sheet.rows[1].seed, 2);
  assert.ok(sheet.rows[1].offset > 0, "the faster group should have a positive start offset");
  assert.ok(Math.abs(sheet.tMax - sheet.rows[0].dur) < 1e-6);
  assert.ok(Math.abs(sheet.tMin - sheet.rows[1].dur) < 1e-6);
});

test("calibrationFactor raises k when the rider rode faster than predicted, ~1 for an exact match", () => {
  const course = buildManualCourse(20, 200);
  const rider = { id: "x", name: "X", w: 70, ftp: 240, pos: "road_drops", build: "medium" };
  const baseline = soloDuration({ ...rider, calib: 1 }, course.segments, p);

  const kFaster = calibrationFactor(rider, course.segments, baseline * 0.9, p, 1);
  assert.ok(kFaster > 1.1 && kFaster < 1.2, `expected ~1.14, got ${kFaster}`);

  const kMatch = calibrationFactor(rider, course.segments, baseline, p, 1);
  assert.ok(Math.abs(kMatch - 1) < 1e-6, `expected ~1, got ${kMatch}`);
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: `pass 8`, `fail 0` (8 `test(...)` blocks above).

- [ ] **Step 4: Commit**

```bash
git add package.json tests/unit/engine.test.mjs
git commit -m "test: add unit tests for lib/engine.mjs"
```

---

## Task 2: Export `buildCourse` + `public/course.js` unit tests

**Files:**
- Modify: `public/course.js`
- Create: `tests/unit/course.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildCourse` becomes a named export of `public/course.js` (was module-private) — no other file needs to import it yet, but Task 14+ frontend files will continue to import `parseGpx`/`parseFit`/`parseCourseFile` exactly as before.

- [ ] **Step 1: Export `buildCourse`**

Modify `public/course.js` — replace:

```javascript
function buildCourse(pp, name) {
```

with:

```javascript
export function buildCourse(pp, name) {
```

- [ ] **Step 2: Write the test file**

Create `tests/unit/course.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { buildCourse, parseFit } from "../../public/course.js";

test("buildCourse turns a flat point line into flat segments with no ascent", () => {
  const pp = [{ d: 0, ele: 100 }, { d: 500, ele: 100 }, { d: 1000, ele: 100 }];
  const c = buildCourse(pp, "flat");
  assert.deepEqual(c.segments, [{ dist: 500, grad: 0 }, { dist: 500, grad: 0 }]);
  assert.equal(c.distanceM, 1000);
  assert.equal(c.ascentM, 0);
  assert.equal(c.name, "flat");
});

test("buildCourse tracks grade and cumulative ascent on a real climb", () => {
  const pp = [];
  for (let i = 0; i < 20; i++) {
    pp.push({ d: i * 100, ele: i < 10 ? i * 20 : 200 }); // climbs 20m/100m for 10 steps, then flat
  }
  const c = buildCourse(pp, "ramp");
  assert.equal(c.distanceM, 1900);
  assert.equal(c.ascentM, 160);
  assert.equal(c.segments.length, 19);
  assert.deepEqual(c.segments.slice(0, 3), [
    { dist: 100, grad: 0.1 }, { dist: 100, grad: 0.1 }, { dist: 100, grad: 0.1 },
  ]);
  assert.deepEqual(c.segments.slice(-3), [
    { dist: 100, grad: 0 }, { dist: 100, grad: 0 }, { dist: 100, grad: 0 },
  ]);
  assert.equal(c.profile.length, 20);
});

test("buildCourse rejects fewer than 2 points", () => {
  assert.throws(() => buildCourse([{ d: 0, ele: 100 }], "x"), /Not enough points/);
});

test("parseFit throws when the buffer has no GPS records", () => {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint8(0, 12);        // header size
  dv.setUint32(4, 4, true);  // data size — too small to contain a real record
  assert.throws(() => parseFit(buf, "x"), /No GPS records/);
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: `pass 12`, `fail 0` (8 from Task 1 + 4 new).

- [ ] **Step 4: Commit**

```bash
git add public/course.js tests/unit/course.test.mjs
git commit -m "test: export buildCourse and add public/course.js unit tests"
```

---

## Task 3: `server.js` testability split (`createApp()` / bootstrap)

**Files:**
- Modify: `server.js`

**Interfaces:**
- Produces: `export function createApp()` — builds and returns a fully configured Express app (no `listen()` call). Later tasks (4+) import this to run the server in-process for tests. The bottom-of-file bootstrap (`initDb()` + `app.listen()`) now only runs when `server.js` is executed directly (`node server.js`), not when imported.

This task is a pure wrap — no route logic changes at all.

- [ ] **Step 1: Update the imports and add the main-module guard**

Modify `server.js` — replace:

```javascript
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, q, initDb } from "./db.js";
```

with:

```javascript
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool, q, initDb } from "./db.js";
```

(One thing this project does NOT have on Windows: comparing `import.meta.url` to a raw `file://${process.argv[1]}` string breaks, because Windows paths use backslashes and no leading slash before the drive letter. `pathToFileURL(...).href` handles that conversion correctly — verified directly on this machine before writing this plan.)

- [ ] **Step 2: Wrap the app assembly in `createApp()`**

Modify `server.js` — replace:

```javascript
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
}));
```

with:

```javascript
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));
```

- [ ] **Step 3: Indent the route registrations by two spaces**

Every `app.post(...)`, `app.get(...)`, `app.patch(...)`, `app.put(...)`, `app.delete(...)` block between the code from Step 2 and the code in Step 4 below is now inside `createApp()`'s function body — indent each of those lines (and their bodies) by two spaces. This is a whitespace-only change; no logic inside any handler changes. (The helper functions above them — `getEvent`, `getRiders`, `publicRider`, `requireOrg`, `eventPayload`, `eventForRider`, `freshAccess`, `isRide`, `normalizeRide`, and the `token`/`genCode`/`baseUrl`/`RIDE_TYPES` constants — stay at module scope, **not** indented, so every route handler still closes over them exactly as before.)

- [ ] **Step 4: Close `createApp()` and rewrite the bootstrap**

Modify `server.js` — replace:

```javascript
// serve the shared engine to the browser (single source of truth, no duplication)
app.get("/engine.mjs", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")); });
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
  .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
```

with:

```javascript
  // serve the shared engine to the browser (single source of truth, no duplication)
  app.get("/engine.mjs", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")); });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  return app;
}

const PORT = process.env.PORT || 3000;
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initDb()
    .then(() => createApp().listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
    .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
}
```

- [ ] **Step 5: Verify the server still starts normally**

This step needs a real Postgres reachable via `DATABASE_URL` — if you don't have one handy locally, it's fine to skip straight to Step 6 and rely on Task 4's Docker-based integration tests as the real verification; just don't skip checking that the file has no syntax errors:

Run: `node --check server.js`
Expected: no output (means no syntax errors).

If you do have a local Postgres, you can additionally run: `$env:DATABASE_URL="postgres://..."; node server.js` and confirm it logs `Pursuit server on :3000` and `GET http://localhost:3000/api/health` returns `{"ok":true}`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "refactor: split server.js into createApp() + guarded bootstrap"
```

---

## Task 4: Docker Compose test DB + integration test harness

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/test-integration.mjs`
- Create: `tests/integration/helpers.mjs`
- Create: `tests/integration/health.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createApp` from `server.js` (Task 3), `pool`/`initDb`/`q` from `db.js`.
- Produces: `startTestServer()` → `Promise<{ server, baseUrl }>` and `stopTestServer(server)` → `Promise<void>` and `closePool()` → `Promise<void>`, from `tests/integration/helpers.mjs`. Tasks 5, 6, 7 import these three functions.

- [ ] **Step 1: Add the Docker Compose file**

Create `docker-compose.yml`:

```yaml
services:
  test-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pursuit_test
      POSTGRES_PASSWORD: pursuit_test
      POSTGRES_DB: pursuit_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
```

(Port 5433, not the default 5432, so this never collides with a real local Postgres. `tmpfs` means the data directory is never written to disk — the container is fully disposable.)

- [ ] **Step 2: Write the integration test harness**

Create `tests/integration/helpers.mjs`:

```javascript
import { createApp } from "../../server.js";
import { pool, initDb, q } from "../../db.js";

let schemaReady = false;

export async function startTestServer() {
  if (!schemaReady) { await initDb(); schemaReady = true; }
  await q("TRUNCATE riders, events RESTART IDENTITY CASCADE");
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

export async function closePool() {
  await pool.end();
}
```

- [ ] **Step 3: Write a smoke test to prove the harness works end-to-end**

Create `tests/integration/health.test.mjs`:

```javascript
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
```

- [ ] **Step 4: Write the orchestration script**

This brings the test DB up, waits for it, runs `node --test tests/integration/*.test.mjs`, and always tears the DB down again — written in Node (not a shell script) so it behaves identically in PowerShell, cmd, and bash.

Create `scripts/test-integration.mjs`:

```javascript
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Pool } = pg;
const TEST_DB_URL = "postgres://pursuit_test:pursuit_test@localhost:5433/pursuit_test";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status ?? 1;
}

async function waitForDb() {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await pool.end().catch(() => {});
  return false;
}

async function main() {
  console.log("Starting test database...");
  run("docker", ["compose", "up", "-d", "test-db"]);
  try {
    console.log("Waiting for test database to be ready...");
    const ready = await waitForDb();
    if (!ready) {
      console.error("Test database did not become ready within 20s.");
      process.exitCode = 1;
      return;
    }
    process.env.DATABASE_URL = TEST_DB_URL;
    console.log("Running integration tests...");
    process.exitCode = run("node", ["--test", "tests/integration/*.test.mjs"]);
  } finally {
    console.log("Stopping test database...");
    run("docker", ["compose", "down"]);
  }
}

main();
```

- [ ] **Step 5: Add the npm scripts**

Modify `package.json` — replace:

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/unit/*.test.mjs"
  },
```

with:

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/unit/*.test.mjs",
    "test:integration": "node scripts/test-integration.mjs",
    "test:all": "npm test && npm run test:integration"
  },
```

- [ ] **Step 6: Run the integration test**

Run: `npm run test:integration`
Expected: logs "Starting test database...", "Waiting for test database to be ready...", "Running integration tests...", then `pass 1`, `fail 0`, then "Stopping test database...". (First run pulls the `postgres:16-alpine` image, so it may take a minute.)

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml scripts/test-integration.mjs tests/integration/helpers.mjs tests/integration/health.test.mjs package.json
git commit -m "test: add Docker-based integration test harness"
```

---

## Task 5: Integration tests — events routes

**Files:**
- Create: `tests/integration/events.test.mjs`

**Interfaces:**
- Consumes: `startTestServer`, `stopTestServer`, `closePool` from `tests/integration/helpers.mjs` (Task 4).

- [ ] **Step 1: Write the test file**

Create `tests/integration/events.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration`
Expected: `pass 7`, `fail 0` (1 from Task 4 + 6 new).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/events.test.mjs
git commit -m "test: add integration tests for events routes"
```

---

## Task 6: Integration tests — riders routes

**Files:**
- Create: `tests/integration/riders.test.mjs`

**Interfaces:**
- Consumes: `startTestServer`, `stopTestServer`, `closePool` from `tests/integration/helpers.mjs`.

- [ ] **Step 1: Write the test file**

Create `tests/integration/riders.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration`
Expected: `pass 12`, `fail 0` (7 from Tasks 4–5 + 5 new).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/riders.test.mjs
git commit -m "test: add integration tests for riders routes"
```

---

## Task 7: Integration tests — groups routes

**Files:**
- Create: `tests/integration/groups.test.mjs`

**Interfaces:**
- Consumes: `startTestServer`, `stopTestServer`, `closePool` from `tests/integration/helpers.mjs`.

- [ ] **Step 1: Write the test file**

Create `tests/integration/groups.test.mjs`:

```javascript
import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";

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

  test("POST /api/events/:code/suggest requires a course to be set first", async () => {
    const create = await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No course", code: "suggest-nocourse" }),
    });
    const ev = await create.json();
    const res = await fetch(`${ctx.baseUrl}/api/events/suggest-nocourse/suggest`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-organiser-token": ev.organiserToken },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration`
Expected: `pass 16`, `fail 0` (12 from Tasks 4–6 + 4 new).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/groups.test.mjs
git commit -m "test: add integration tests for groups routes"
```

---

## Task 8: `routes/helpers.js` (shared helpers, validators, `asyncRoute`) + centralized error middleware

**Files:**
- Create: `routes/helpers.js`
- Create: `tests/unit/helpers.test.mjs`
- Modify: `server.js`

**Interfaces:**
- Produces (all named exports of `routes/helpers.js`, consumed by Tasks 9–12): `token()`, `genCode()`, `groupId()`, `baseUrl(req)`, `clampGroupSize(value, fallback)`, `truncate(value, maxLen, fallback)`, `getEvent(code)`, `getRiders(eventId)`, `eventForRider(riderId)`, `publicRider(row)`, `engineRider(row)`, `engineRidersById(rows)`, `paramsOf(ev)`, `requireOrg(ev, req, res)`, `eventPayload(ev)`, `asyncRoute(fn)`.
- Consumes: `q` from `db.js`, `DEFAULT_PARAMS`/`computeSheet` from `lib/engine.mjs`.

This task does **not** change any of the 13 route handlers still living in `server.js` — those get replaced wholesale (using these new helpers) as each resource moves to its own router file in Tasks 9–12. This task only adds the new shared file and wires the error middleware into `createApp()`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/helpers.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { clampGroupSize, truncate, publicRider, engineRider, paramsOf } from "../../routes/helpers.js";

test("clampGroupSize clamps to the 1-8 range and falls back when null", () => {
  assert.equal(clampGroupSize(0, 2), 1);
  assert.equal(clampGroupSize(12, 2), 8);
  assert.equal(clampGroupSize(5, 2), 5);
  assert.equal(clampGroupSize(null, 2), 2);
});

test("truncate slices strings to a max length and falls back when null", () => {
  assert.equal(truncate("a".repeat(100), 80, "x").length, 80);
  assert.equal(truncate(null, 80, "fallback"), "fallback");
});

test("publicRider shapes a DB row for API responses", () => {
  const row = { id: 1, name: "Ann", weight: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05, strava_athlete_id: 42, last_refined_at: "2026-01-01" };
  assert.deepEqual(publicRider(row), { id: 1, name: "Ann", w: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05, strava: true, lastRefined: "2026-01-01" });
});

test("engineRider shapes a DB row for the physics engine", () => {
  const row = { id: 1, name: "Ann", weight: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05 };
  assert.deepEqual(engineRider(row), { id: 1, name: "Ann", w: 68, ftp: 220, pos: "road_drops", build: "medium", calib: 1.05 });
});

test("paramsOf merges stored params over defaults", () => {
  const merged = paramsOf({ params_json: { effort: 90 } });
  assert.equal(merged.effort, 90);
  assert.equal(merged.rho, 1.225); // a default that wasn't overridden
});

test("paramsOf falls back to all defaults when params_json is null", () => {
  const merged = paramsOf({ params_json: null });
  assert.equal(merged.effort, 100);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../routes/helpers.js'`.

- [ ] **Step 3: Write `routes/helpers.js`**

Create `routes/helpers.js`:

```javascript
import crypto from "node:crypto";
import { q } from "../db.js";
import { DEFAULT_PARAMS, computeSheet } from "../lib/engine.mjs";

export const token = () => crypto.randomBytes(16).toString("hex");
export const genCode = () => "ride-" + crypto.randomBytes(3).toString("hex");
export const groupId = () => "g" + crypto.randomBytes(3).toString("hex");
export const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

export function clampGroupSize(value, fallback) {
  if (value == null) return fallback;
  return Math.max(1, Math.min(8, value | 0));
}

export function truncate(value, maxLen, fallback) {
  if (value == null) return fallback;
  return String(value).slice(0, maxLen);
}

export async function getEvent(code) {
  const { rows } = await q("SELECT * FROM events WHERE code=$1", [code]);
  return rows[0] || null;
}

export async function getRiders(eventId) {
  const { rows } = await q("SELECT * FROM riders WHERE event_id=$1 ORDER BY id", [eventId]);
  return rows;
}

export async function eventForRider(riderId) {
  const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
  return rows[0] || null;
}

export const publicRider = (r) => ({ id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib, strava: !!r.strava_athlete_id, lastRefined: r.last_refined_at });

export const engineRider = (r) => ({ id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib });

export const engineRidersById = (riders) => Object.fromEntries(riders.map((r) => [r.id, engineRider(r)]));

export const paramsOf = (ev) => ({ ...DEFAULT_PARAMS, ...(ev.params_json || {}) });

export function requireOrg(ev, req, res) {
  const t = req.get("x-organiser-token");
  if (!ev) { res.status(404).json({ error: "No event with that code." }); return false; }
  if (!t || t !== ev.organiser_token) { res.status(403).json({ error: "Organiser token required." }); return false; }
  return true;
}

export async function eventPayload(ev) {
  const riders = await getRiders(ev.id);
  const byId = engineRidersById(riders);
  const groups = ev.groups_json || [];
  const sheet = ev.course_json ? computeSheet(groups, byId, ev.course_json.segments, paramsOf(ev)) : { rows: [], tMax: 0, tMin: 0 };
  return {
    event: { code: ev.code, name: ev.name, groupSize: ev.group_size, firstStart: ev.first_start, course: ev.course_json, params: paramsOf(ev) },
    riders: riders.map(publicRider), groups, sheet,
  };
}

export const asyncRoute = (fn) => (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `pass 18`, `fail 0` (12 from Tasks 1–2 + 6 new).

- [ ] **Step 5: Add the centralized error-handling middleware to `server.js`**

Modify `server.js` — replace:

```javascript
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  return app;
}
```

with:

```javascript
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  // eslint-disable-next-line no-unused-vars -- 4-arg signature is what makes Express treat this as an error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
```

(This is inert until Task 9+ starts using `asyncRoute` — nothing calls `next(err)` yet, so nothing changes in existing behavior.)

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 7: Commit**

```bash
git add routes/helpers.js tests/unit/helpers.test.mjs server.js
git commit -m "refactor: add routes/helpers.js and centralized error middleware"
```

---

## Task 9: Extract `routes/events.js`

**Files:**
- Create: `routes/events.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `getEvent`, `requireOrg`, `eventPayload`, `token`, `genCode`, `clampGroupSize`, `truncate`, `asyncRoute` from `routes/helpers.js`; `q` from `db.js`; `buildManualCourse` from `lib/engine.mjs`.
- Produces: default-exported Express `Router` mounted at the app root (its routes already include the full `/api/events...` paths).

- [ ] **Step 1: Create the router**

Create `routes/events.js`:

```javascript
import express from "express";
import { q } from "../db.js";
import { getEvent, requireOrg, eventPayload, token, genCode, clampGroupSize, truncate, asyncRoute } from "./helpers.js";
import { buildManualCourse } from "../lib/engine.mjs";

const router = express.Router();

router.post("/api/events", asyncRoute(async (req, res) => {
  const name = truncate(req.body?.name, 80, "Pursuit");
  let code = (req.body?.code || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "") || genCode();
  const orgToken = token();
  const course = buildManualCourse(45, 500);
  try {
    const { rows } = await q(
      "INSERT INTO events(code,name,organiser_token,course_json,params_json,group_size,first_start,groups_json) VALUES($1,$2,$3,$4,$5,$6,$7,'[]') RETURNING *",
      [code, name, orgToken, course, {}, 2, "09:30"]
    );
    res.json({ ...(await eventPayload(rows[0])), organiserToken: orgToken });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "That event code is taken — pick another." });
    throw e;
  }
}));

router.get("/api/events/:code", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  res.json(await eventPayload(ev));
}));

router.patch("/api/events/:code", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const b = req.body || {};
  const name = truncate(b.name, 80, ev.name);
  const groupSize = clampGroupSize(b.groupSize, ev.group_size);
  const firstStart = b.firstStart != null ? String(b.firstStart).slice(0, 5) : ev.first_start;
  let course = ev.course_json;
  if (b.courseManual) course = buildManualCourse(Number(b.courseManual.km) || 45, Number(b.courseManual.ascent) || 0, (b.params || ev.params_json || {}).climbGrad || 0.05);
  else if (b.course != null) course = b.course;   // or a pre-parsed { segments, distanceM, ascentM, name } (e.g. from a GPX/FIT parsed in the browser)
  const params = b.params != null ? b.params : ev.params_json;
  const { rows } = await q(
    "UPDATE events SET name=$1,group_size=$2,first_start=$3,course_json=$4,params_json=$5 WHERE id=$6 RETURNING *",
    [name, groupSize, firstStart, course, params, ev.id]
  );
  res.json(await eventPayload(rows[0]));
}));

export default router;
```

- [ ] **Step 2: Mount the router and remove the old inline routes from `server.js`**

Modify `server.js` — replace:

```javascript
import { pool, q, initDb } from "./db.js";
import { DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet, calibrationFactor } from "./lib/engine.mjs";
import { authUrl, exchange, refresh, recentActivities, activity, matchByDistance } from "./lib/strava.mjs";
```

with:

```javascript
import { pool, q, initDb } from "./db.js";
import { DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet, calibrationFactor } from "./lib/engine.mjs";
import { authUrl, exchange, refresh, recentActivities, activity, matchByDistance } from "./lib/strava.mjs";
import eventsRouter from "./routes/events.js";
```

(`buildManualCourse` is unused in `server.js` from this point on — leave the import for now, it'll be cleaned up in Task 13's final sweep along with the others that go unused as more routers are extracted.)

Modify `server.js` — replace:

```javascript
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));
```

with:

```javascript
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));

  app.use(eventsRouter);
```

Modify `server.js` — remove this entire block (the three routes now live in `routes/events.js`):

```javascript
  /* ---- events -------------------------------------------------------------- */
  app.post("/api/events", async (req, res) => {
    try {
      const name = (req.body?.name || "Pursuit").slice(0, 80);
      let code = (req.body?.code || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "") || genCode();
      const orgToken = token();
      const course = buildManualCourse(45, 500);
      const { rows } = await q(
        "INSERT INTO events(code,name,organiser_token,course_json,params_json,group_size,first_start,groups_json) VALUES($1,$2,$3,$4,$5,$6,$7,'[]') RETURNING *",
        [code, name, orgToken, course, {}, 2, "09:30"]
      );
      res.json({ ...(await eventPayload(rows[0])), organiserToken: orgToken });
    } catch (e) {
      if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "That event code is taken — pick another." });
      console.error(e); res.status(500).json({ error: "Could not create event." });
    }
  });

  app.get("/api/events/:code", async (req, res) => {
    const ev = await getEvent(req.params.code);
    if (!ev) return res.status(404).json({ error: "No event with that code." });
    res.json(await eventPayload(ev));
  });

  app.patch("/api/events/:code", async (req, res) => {
    const ev = await getEvent(req.params.code);
    if (!requireOrg(ev, req, res)) return;
    const b = req.body || {};
    const name = b.name != null ? String(b.name).slice(0, 80) : ev.name;
    const groupSize = b.groupSize != null ? Math.max(1, Math.min(8, b.groupSize | 0)) : ev.group_size;
    const firstStart = b.firstStart != null ? String(b.firstStart).slice(0, 5) : ev.first_start;
    let course = ev.course_json;
    if (b.courseManual) course = buildManualCourse(Number(b.courseManual.km) || 45, Number(b.courseManual.ascent) || 0, (b.params || ev.params_json || {}).climbGrad || 0.05);
    else if (b.course != null) course = b.course;   // or a pre-parsed { segments, distanceM, ascentM, name } (e.g. from a GPX/FIT parsed in the browser)
    const params = b.params != null ? b.params : ev.params_json;
    const { rows } = await q(
      "UPDATE events SET name=$1,group_size=$2,first_start=$3,course_json=$4,params_json=$5 WHERE id=$6 RETURNING *",
      [name, groupSize, firstStart, course, params, ev.id]
    );
    res.json(await eventPayload(rows[0]));
  });

```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall — identical counts to Task 8, since this is a pure move.

- [ ] **Step 4: Commit**

```bash
git add routes/events.js server.js
git commit -m "refactor: extract routes/events.js"
```

---

## Task 10: Extract `routes/riders.js`

**Files:**
- Create: `routes/riders.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `getEvent`, `eventForRider`, `requireOrg`, `publicRider`, `truncate`, `asyncRoute` from `routes/helpers.js`; `q` from `db.js`.

- [ ] **Step 1: Create the router**

Create `routes/riders.js`:

```javascript
import express from "express";
import { q } from "../db.js";
import { getEvent, eventForRider, requireOrg, publicRider, truncate, asyncRoute } from "./helpers.js";

const router = express.Router();

// public self sign-up
router.post("/api/events/:code/riders", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Name is required." });
  const { rows } = await q(
    "INSERT INTO riders(event_id,name,weight,ftp,pos,build) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [ev.id, truncate(b.name.trim(), 60, ""), Number(b.w) || 75, Number(b.ftp) || 240, b.pos || "road_drops", b.build || "medium"]
  );
  res.json(publicRider(rows[0]));
}));

router.patch("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const b = req.body || {};
  const { rows: cur } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  if (!cur[0]) return res.status(404).json({ error: "No such rider." });
  const r = cur[0];
  const { rows } = await q(
    "UPDATE riders SET name=$1,weight=$2,ftp=$3,pos=$4,build=$5 WHERE id=$6 RETURNING *",
    [truncate(b.name, 60, r.name), b.w != null ? Number(b.w) : r.weight,
     b.ftp != null ? Number(b.ftp) : r.ftp, b.pos || r.pos, b.build || r.build, r.id]
  );
  res.json(publicRider(rows[0]));
}));

router.delete("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  await q("DELETE FROM riders WHERE id=$1", [req.params.id]);
  // drop the rider from any stored groups
  const groups = (ev.groups_json || []).map((g) => ({ ...g, members: g.members.filter((m) => String(m) !== String(req.params.id)) })).filter((g) => g.members.length || g.locked);
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json({ ok: true });
}));

export default router;
```

- [ ] **Step 2: Mount the router and remove the old inline routes from `server.js`**

Modify `server.js` — replace:

```javascript
import eventsRouter from "./routes/events.js";
```

with:

```javascript
import eventsRouter from "./routes/events.js";
import ridersRouter from "./routes/riders.js";
```

Modify `server.js` — replace:

```javascript
  app.use(eventsRouter);
```

with:

```javascript
  app.use(eventsRouter);
  app.use(ridersRouter);
```

Modify `server.js` — remove this entire block:

```javascript
  /* ---- riders -------------------------------------------------------------- */
  // public self sign-up
  app.post("/api/events/:code/riders", async (req, res) => {
    const ev = await getEvent(req.params.code);
    if (!ev) return res.status(404).json({ error: "No event with that code." });
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: "Name is required." });
    const { rows } = await q(
      "INSERT INTO riders(event_id,name,weight,ftp,pos,build) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [ev.id, b.name.trim().slice(0, 60), Number(b.w) || 75, Number(b.ftp) || 240, b.pos || "road_drops", b.build || "medium"]
    );
    res.json(publicRider(rows[0]));
  });

  async function eventForRider(riderId) {
    const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
    return rows[0] || null;
  }

  app.patch("/api/riders/:id", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    const b = req.body || {};
    const { rows: cur } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: "No such rider." });
    const r = cur[0];
    const { rows } = await q(
      "UPDATE riders SET name=$1,weight=$2,ftp=$3,pos=$4,build=$5 WHERE id=$6 RETURNING *",
      [b.name != null ? String(b.name).slice(0, 60) : r.name, b.w != null ? Number(b.w) : r.weight,
       b.ftp != null ? Number(b.ftp) : r.ftp, b.pos || r.pos, b.build || r.build, r.id]
    );
    res.json(publicRider(rows[0]));
  });

  app.delete("/api/riders/:id", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    await q("DELETE FROM riders WHERE id=$1", [req.params.id]);
    // drop the rider from any stored groups
    const groups = (ev.groups_json || []).map((g) => ({ ...g, members: g.members.filter((m) => String(m) !== String(req.params.id)) })).filter((g) => g.members.length || g.locked);
    await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
    res.json({ ok: true });
  });

```

Note: `eventForRider` is defined **twice** at this point in the original file — once here (removed above) and once used later by the Strava routes (which is why the version further down, still in `server.js`, must stay until Task 12 removes it too). This duplication is exactly the kind of thing this refactor is meant to clean up — Task 12 removes the second copy when the Strava routes move out, since `routes/riders.js` and `routes/strava.js` each import the single shared `eventForRider` from `routes/helpers.js` instead.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 4: Commit**

```bash
git add routes/riders.js server.js
git commit -m "refactor: extract routes/riders.js"
```

---

## Task 11: Extract `routes/groups.js`

**Files:**
- Create: `routes/groups.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `getEvent`, `getRiders`, `requireOrg`, `eventPayload`, `paramsOf`, `engineRidersById`, `clampGroupSize`, `groupId`, `asyncRoute` from `routes/helpers.js`; `q` from `db.js`; `suggestGroups` from `lib/engine.mjs`.

- [ ] **Step 1: Create the router**

Create `routes/groups.js`:

```javascript
import express from "express";
import { q } from "../db.js";
import { getEvent, getRiders, requireOrg, eventPayload, paramsOf, engineRidersById, clampGroupSize, groupId, asyncRoute } from "./helpers.js";
import { suggestGroups } from "../lib/engine.mjs";

const router = express.Router();

router.post("/api/events/:code/suggest", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  if (!ev.course_json) return res.status(400).json({ error: "Set a course first." });
  const riders = await getRiders(ev.id);
  const byId = engineRidersById(riders);
  const locked = (ev.groups_json || []).filter((g) => g.locked);
  const lockedIds = new Set(locked.flatMap((g) => g.members.map(String)));
  const pool = riders.map((r) => r.id).filter((id) => !lockedIds.has(String(id)));
  const size = clampGroupSize(req.body?.size, ev.group_size);
  const { groups, leftover } = suggestGroups(pool, byId, ev.course_json.segments, paramsOf(ev), size);
  const newGroups = [...locked, ...groups.map((m) => ({ id: groupId(), members: m, locked: false }))];
  await q("UPDATE events SET groups_json=$1, group_size=$2 WHERE id=$3", [JSON.stringify(newGroups), size, ev.id]);
  const updated = await getEvent(ev.code);
  res.json({ ...(await eventPayload(updated)), leftover });
}));

// save a manual arrangement
router.put("/api/events/:code/groups", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!requireOrg(ev, req, res)) return;
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json(await eventPayload(await getEvent(ev.code)));
}));

export default router;
```

- [ ] **Step 2: Mount the router and remove the old inline routes from `server.js`**

Modify `server.js` — replace:

```javascript
import ridersRouter from "./routes/riders.js";
```

with:

```javascript
import ridersRouter from "./routes/riders.js";
import groupsRouter from "./routes/groups.js";
```

Modify `server.js` — replace:

```javascript
  app.use(ridersRouter);
```

with:

```javascript
  app.use(ridersRouter);
  app.use(groupsRouter);
```

Modify `server.js` — remove this entire block:

```javascript
  /* ---- grouping ------------------------------------------------------------ */
  app.post("/api/events/:code/suggest", async (req, res) => {
    const ev = await getEvent(req.params.code);
    if (!requireOrg(ev, req, res)) return;
    if (!ev.course_json) return res.status(400).json({ error: "Set a course first." });
    const riders = await getRiders(ev.id);
    const byId = Object.fromEntries(riders.map((r) => [r.id, { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
    const locked = (ev.groups_json || []).filter((g) => g.locked);
    const lockedIds = new Set(locked.flatMap((g) => g.members.map(String)));
    const pool = riders.map((r) => r.id).filter((id) => !lockedIds.has(String(id)));
    const size = req.body?.size != null ? Math.max(1, Math.min(8, req.body.size | 0)) : ev.group_size;
    const { groups, leftover } = suggestGroups(pool, byId, ev.course_json.segments, paramsOf(ev), size);
    const newGroups = [...locked, ...groups.map((m) => ({ id: "g" + crypto.randomBytes(3).toString("hex"), members: m, locked: false }))];
    await q("UPDATE events SET groups_json=$1, group_size=$2 WHERE id=$3", [JSON.stringify(newGroups), size, ev.id]);
    const updated = await getEvent(ev.code);
    res.json({ ...(await eventPayload(updated)), leftover });
  });

  // save a manual arrangement
  app.put("/api/events/:code/groups", async (req, res) => {
    const ev = await getEvent(req.params.code);
    if (!requireOrg(ev, req, res)) return;
    const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
    await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
    res.json(await eventPayload(await getEvent(ev.code)));
  });

```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 4: Commit**

```bash
git add routes/groups.js server.js
git commit -m "refactor: extract routes/groups.js"
```

---

## Task 12: Extract `routes/strava.js` + remove dead code

**Files:**
- Create: `routes/strava.js`
- Modify: `server.js`
- Modify: `lib/strava.mjs`

**Interfaces:**
- Consumes: `eventForRider`, `requireOrg`, `paramsOf`, `baseUrl`, `engineRider`, `asyncRoute` from `routes/helpers.js`; `q` from `db.js`; `authUrl`, `exchange`, `refresh`, `recentActivities`, `activity` from `lib/strava.mjs`; `calibrationFactor` from `lib/engine.mjs`.

- [ ] **Step 1: Remove the dead `matchByDistance` export**

Modify `lib/strava.mjs` — remove this block (it's exported but never called anywhere in the codebase; `server.js` reimplements the same matching logic inline instead):

```javascript

// Most recent ride whose distance is within `tol` of the course distance.
export function matchByDistance(acts, targetM, tol = 0.08) {
  if (!targetM) return null;
  return acts
    .filter((a) => (a.type === "Ride" || a.sport_type === "Ride") && Math.abs(a.distance - targetM) / targetM <= tol)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0] || null;
}
```

- [ ] **Step 2: Create the router**

Create `routes/strava.js`:

```javascript
import express from "express";
import { q } from "../db.js";
import { eventForRider, requireOrg, paramsOf, baseUrl, engineRider, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity } from "../lib/strava.mjs";
import { calibrationFactor } from "../lib/engine.mjs";

const router = express.Router();

// organiser (or rider) starts the link: /auth/strava?code=EVENT&rider=ID
router.get("/auth/strava", asyncRoute(async (req, res) => {
  const { code, rider } = req.query;
  if (!code || !rider) return res.status(400).send("Missing event code or rider id.");
  if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send("Strava is not configured on this server.");
  const state = Buffer.from(JSON.stringify({ code, rider })).toString("base64url");
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
}));

router.get("/auth/strava/callback", asyncRoute(async (req, res) => {
  try {
    const { code: authCode, state, error } = req.query;
    if (error) return res.redirect(`/?stravaerror=1`);
    const { code, rider } = JSON.parse(Buffer.from(String(state), "base64url").toString());
    const tok = await exchange(authCode);
    await q(
      "UPDATE riders SET strava_athlete_id=$1, strava_access_token=$2, strava_refresh_token=$3, strava_expires_at=$4 WHERE id=$5",
      [tok.athlete?.id || null, tok.access_token, tok.refresh_token, tok.expires_at, rider]
    );
    res.redirect(`/?code=${encodeURIComponent(code)}&stravalinked=1`);
  } catch (e) {
    console.error(e); res.redirect(`/?stravaerror=1`);
  }
}));

// ensure a usable access token, refreshing if near expiry
async function freshAccess(r) {
  let access = r.strava_access_token;
  if (r.strava_expires_at && Date.now() / 1000 > r.strava_expires_at - 60) {
    const t = await refresh(r.strava_refresh_token);
    access = t.access_token;
    await q("UPDATE riders SET strava_access_token=$1, strava_refresh_token=$2, strava_expires_at=$3 WHERE id=$4", [t.access_token, t.refresh_token, t.expires_at, r.id]);
  }
  return access;
}
const RIDE_TYPES = new Set(["Ride", "GravelRide", "VirtualRide", "MountainBikeRide", "EBikeRide"]);
const isRide = (a) => RIDE_TYPES.has(a.sport_type) || a.type === "Ride";

function normalizeRide(a, courseM, rider, segments, params) {
  const matches = courseM ? Math.abs(a.distance - courseM) / courseM <= 0.08 : false;
  const weighted = a.device_watts ? a.weighted_average_watts : null;
  const impliedCalib = matches && segments ? Number(calibrationFactor(rider, segments, a.moving_time, params, rider.calib).toFixed(3)) : null;
  return {
    id: a.id, name: a.name, date: a.start_date, distanceKm: +(a.distance / 1000).toFixed(1),
    movingTime: a.moving_time, avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
    avgWatts: a.average_watts != null ? Math.round(a.average_watts) : null,
    weightedWatts: weighted != null ? Math.round(weighted) : null,
    hasPower: !!a.device_watts, commute: !!a.commute, matches, impliedCalib,
  };
}

// list a rider's recent rides so the organiser can choose which to calibrate from
router.get("/api/riders/:id/rides", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    const acts = await recentActivities(access, 50);
    const courseM = ev.course_json?.distanceM, segs = ev.course_json?.segments;
    const rider = engineRider(r);
    const cutoff = Date.now() - 42 * 864e5;
    const rides = acts
      .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
      .map((a) => normalizeRide(a, courseM, rider, segs, paramsOf(ev)))
      .sort((a, b) => (b.matches - a.matches) || (a.commute - b.commute) || (a.movingTime - b.movingTime));
    res.json({ rides, course: { distanceKm: courseM ? +(courseM / 1000).toFixed(1) : null } });
  } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
}));

// refine a rider. Body: { activityId?, mode? }  mode = "course" (time on course) | "power" (FTP from watts).
// No activityId → auto-pick the fastest recent non-commute ride matching the course distance.
router.post("/api/riders/:id/refine", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  const mode = req.body?.mode === "power" ? "power" : "course";
  const activityId = req.body?.activityId || null;
  if (mode === "course" && !ev.course_json) return res.status(400).json({ error: "Set a course first." });
  try {
    const access = await freshAccess(r);
    let act;
    if (activityId) {
      act = await activity(access, activityId);
    } else {
      const acts = await recentActivities(access, 50);
      const courseM = ev.course_json?.distanceM;
      const cutoff = Date.now() - 42 * 864e5;
      act = acts.filter((a) => isRide(a) && !a.commute && new Date(a.start_date).getTime() >= cutoff && courseM && Math.abs(a.distance - courseM) / courseM <= 0.08)
        .sort((a, b) => a.moving_time - b.moving_time)[0];
      if (!act) return res.json({ matched: false, message: "No recent non-commute ride close to the course distance — pick one manually." });
    }
    if (mode === "power") {
      const watts = (act.device_watts ? act.weighted_average_watts : act.average_watts) || act.average_watts;
      if (!watts) return res.status(400).json({ error: "That ride has no power data to read an FTP from." });
      const ftp = Math.round(watts);
      await q("UPDATE riders SET ftp=$1, calib=1, last_refined_at=now() WHERE id=$2", [ftp, r.id]);
      return res.json({ matched: true, mode: "power", activity: act.name, ftp, hadPower: !!act.device_watts });
    }
    const rider = engineRider(r);
    const k = calibrationFactor(rider, ev.course_json.segments, act.moving_time, paramsOf(ev), r.calib);
    await q("UPDATE riders SET calib=$1, last_refined_at=now() WHERE id=$2", [k, r.id]);
    res.json({ matched: true, mode: "course", activity: act.name, distanceKm: (act.distance / 1000).toFixed(1), movingTime: act.moving_time, calib: Number(k.toFixed(3)), effectiveFtp: Math.round(r.ftp * k) });
  } catch (e) {
    console.error(e); res.status(502).json({ error: "Strava request failed — try again." });
  }
}));

export default router;
```

- [ ] **Step 3: Mount the router and remove the old inline routes from `server.js`**

Modify `server.js` — replace:

```javascript
import groupsRouter from "./routes/groups.js";
```

with:

```javascript
import groupsRouter from "./routes/groups.js";
import stravaRouter from "./routes/strava.js";
```

Modify `server.js` — replace:

```javascript
  app.use(groupsRouter);
```

with:

```javascript
  app.use(groupsRouter);
  app.use(stravaRouter);
```

Modify `server.js` — remove this entire block (everything from the Strava OAuth section through the end of the `refine` route, including the second `eventForRider` definition):

```javascript
  /* ---- Strava OAuth -------------------------------------------------------- */
  // organiser (or rider) starts the link: /auth/strava?code=EVENT&rider=ID
  app.get("/auth/strava", async (req, res) => {
    const { code, rider } = req.query;
    if (!code || !rider) return res.status(400).send("Missing event code or rider id.");
    if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send("Strava is not configured on this server.");
    const state = Buffer.from(JSON.stringify({ code, rider })).toString("base64url");
    res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
  });

  app.get("/auth/strava/callback", async (req, res) => {
    try {
      const { code: authCode, state, error } = req.query;
      if (error) return res.redirect(`/?stravaerror=1`);
      const { code, rider } = JSON.parse(Buffer.from(String(state), "base64url").toString());
      const tok = await exchange(authCode);
      await q(
        "UPDATE riders SET strava_athlete_id=$1, strava_access_token=$2, strava_refresh_token=$3, strava_expires_at=$4 WHERE id=$5",
        [tok.athlete?.id || null, tok.access_token, tok.refresh_token, tok.expires_at, rider]
      );
      res.redirect(`/?code=${encodeURIComponent(code)}&stravalinked=1`);
    } catch (e) {
      console.error(e); res.redirect(`/?stravaerror=1`);
    }
  });

  // ensure a usable access token, refreshing if near expiry
  async function freshAccess(r) {
    let access = r.strava_access_token;
    if (r.strava_expires_at && Date.now() / 1000 > r.strava_expires_at - 60) {
      const t = await refresh(r.strava_refresh_token);
      access = t.access_token;
      await q("UPDATE riders SET strava_access_token=$1, strava_refresh_token=$2, strava_expires_at=$3 WHERE id=$4", [t.access_token, t.refresh_token, t.expires_at, r.id]);
    }
    return access;
  }
  const RIDE_TYPES = new Set(["Ride", "GravelRide", "VirtualRide", "MountainBikeRide", "EBikeRide"]);
  const isRide = (a) => RIDE_TYPES.has(a.sport_type) || a.type === "Ride";

  function normalizeRide(a, courseM, rider, segments, params) {
    const matches = courseM ? Math.abs(a.distance - courseM) / courseM <= 0.08 : false;
    const weighted = a.device_watts ? a.weighted_average_watts : null;
    const impliedCalib = matches && segments ? Number(calibrationFactor(rider, segments, a.moving_time, params, rider.calib).toFixed(3)) : null;
    return {
      id: a.id, name: a.name, date: a.start_date, distanceKm: +(a.distance / 1000).toFixed(1),
      movingTime: a.moving_time, avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
      avgWatts: a.average_watts != null ? Math.round(a.average_watts) : null,
      weightedWatts: weighted != null ? Math.round(weighted) : null,
      hasPower: !!a.device_watts, commute: !!a.commute, matches, impliedCalib,
    };
  }

  // list a rider's recent rides so the organiser can choose which to calibrate from
  app.get("/api/riders/:id/rides", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
    try {
      const access = await freshAccess(r);
      const acts = await recentActivities(access, 50);
      const courseM = ev.course_json?.distanceM, segs = ev.course_json?.segments;
      const rider = { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib };
      const cutoff = Date.now() - 42 * 864e5;
      const rides = acts
        .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
        .map((a) => normalizeRide(a, courseM, rider, segs, paramsOf(ev)))
        .sort((a, b) => (b.matches - a.matches) || (a.commute - b.commute) || (a.movingTime - b.movingTime));
      res.json({ rides, course: { distanceKm: courseM ? +(courseM / 1000).toFixed(1) : null } });
    } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
  });

  // refine a rider. Body: { activityId?, mode? }  mode = "course" (time on course) | "power" (FTP from watts).
  // No activityId → auto-pick the fastest recent non-commute ride matching the course distance.
  app.post("/api/riders/:id/refine", async (req, res) => {
    const ev = await eventForRider(req.params.id);
    if (!requireOrg(ev, req, res)) return;
    const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
    const mode = req.body?.mode === "power" ? "power" : "course";
    const activityId = req.body?.activityId || null;
    if (mode === "course" && !ev.course_json) return res.status(400).json({ error: "Set a course first." });
    try {
      const access = await freshAccess(r);
      let act;
      if (activityId) {
        act = await activity(access, activityId);
      } else {
        const acts = await recentActivities(access, 50);
        const courseM = ev.course_json?.distanceM;
        const cutoff = Date.now() - 42 * 864e5;
        act = acts.filter((a) => isRide(a) && !a.commute && new Date(a.start_date).getTime() >= cutoff && courseM && Math.abs(a.distance - courseM) / courseM <= 0.08)
          .sort((a, b) => a.moving_time - b.moving_time)[0];
        if (!act) return res.json({ matched: false, message: "No recent non-commute ride close to the course distance — pick one manually." });
      }
      if (mode === "power") {
        const watts = (act.device_watts ? act.weighted_average_watts : act.average_watts) || act.average_watts;
        if (!watts) return res.status(400).json({ error: "That ride has no power data to read an FTP from." });
        const ftp = Math.round(watts);
        await q("UPDATE riders SET ftp=$1, calib=1, last_refined_at=now() WHERE id=$2", [ftp, r.id]);
        return res.json({ matched: true, mode: "power", activity: act.name, ftp, hadPower: !!act.device_watts });
      }
      const rider = { id: r.id, name: r.name, w: r.weight, ftp: r.ftp, pos: r.pos, build: r.build };
      const k = calibrationFactor(rider, ev.course_json.segments, act.moving_time, paramsOf(ev), r.calib);
      await q("UPDATE riders SET calib=$1, last_refined_at=now() WHERE id=$2", [k, r.id]);
      res.json({ matched: true, mode: "course", activity: act.name, distanceKm: (act.distance / 1000).toFixed(1), movingTime: act.moving_time, calib: Number(k.toFixed(3)), effectiveFtp: Math.round(r.ftp * k) });
    } catch (e) {
      console.error(e); res.status(502).json({ error: "Strava request failed — try again." });

    }
  });

```

- [ ] **Step 4: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 5: Commit**

```bash
git add routes/strava.js server.js lib/strava.mjs
git commit -m "refactor: extract routes/strava.js, remove dead matchByDistance export"
```

---

## Task 13: Finalize `server.js` + `.env.example` + README update

**Files:**
- Modify: `server.js`
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:** none — this is cleanup only, no new exports.

At this point `server.js` should just be: imports, `__dirname`, `createApp()` (static hosting + 4 router mounts + `/engine.mjs` + `/api/health` + catch-all + error middleware), and the guarded bootstrap. The module-scope helper functions (`token`, `genCode`, `getEvent`, `getRiders`, `publicRider`, `paramsOf`, `requireOrg`, `eventPayload`) that used to live between `__dirname` and `createApp()` are no longer referenced by anything in this file (every route that used them has moved to a router file that imports its own copy from `routes/helpers.js`) — remove them along with any now-unused imports.

- [ ] **Step 1: Confirm what's actually still used in `server.js`**

Run: `Select-String -Path server.js -Pattern "pool|crypto|DEFAULT_PARAMS|buildManualCourse|suggestGroups|computeSheet|calibrationFactor|authUrl|exchange|refresh|recentActivities|activity\b"`

Expected: no matches outside the `import` lines themselves — every one of these was only used by the route handlers that have now moved out.

- [ ] **Step 2: Rewrite `server.js`**

Replace the entire contents of `server.js` with:

```javascript
import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initDb } from "./db.js";
import eventsRouter from "./routes/events.js";
import ridersRouter from "./routes/riders.js";
import groupsRouter from "./routes/groups.js";
import stravaRouter from "./routes/strava.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, p) => { if (/\.(js|mjs|css|html)$/.test(p)) res.setHeader("Cache-Control", "no-cache"); },
  }));

  app.use(eventsRouter);
  app.use(ridersRouter);
  app.use(groupsRouter);
  app.use(stravaRouter);

  // serve the shared engine to the browser (single source of truth, no duplication)
  app.get("/engine.mjs", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/javascript").sendFile(path.join(__dirname, "lib", "engine.mjs")); });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}

const PORT = process.env.PORT || 3000;
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initDb()
    .then(() => createApp().listen(PORT, () => console.log(`Pursuit server on :${PORT}`)))
    .catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
}
```

- [ ] **Step 3: Add `.env.example`**

Create `.env.example`:

```
# Postgres connection string. Railway sets this automatically when you add
# the Postgres plugin; for local dev, point it at your own Postgres.
DATABASE_URL=postgres://user:password@localhost:5432/pursuit

# Public base URL of this deployment, used to build the Strava OAuth
# callback URL. On Railway this is your app's https://<name>.up.railway.app.
BASE_URL=http://localhost:3000

# From a Strava API app at https://www.strava.com/settings/api — required
# only if you want the Strava linking/refine features to work.
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=

# Port to listen on. Railway sets this automatically; defaults to 3000.
PORT=3000

# Postgres SSL mode override. Leave unset — SSL is auto-detected (on for
# remote hosts, off for localhost). Set to "disable" if you hit "server
# does not support SSL connections" against a non-Railway Postgres.
PGSSL=
```

- [ ] **Step 4: Update the README file listing**

Modify `README.md` — replace:

```markdown
```
server.js          Express API + Strava OAuth + static hosting
db.js / schema.sql Postgres pool and tables (events, riders)
lib/engine.mjs     N-up paceline physics, grouping, start-sheet, calibration
lib/strava.mjs     Strava OAuth + activity fetch/match
public/            Organiser UI + rider sign-up page (no build step)
```
```

with:

```markdown
```
server.js          App assembly (createApp()) + bootstrap
routes/            Express routers by resource (events, riders, groups,
                    strava) + routes/helpers.js (shared DB/response helpers)
db.js / schema.sql Postgres pool and tables (events, riders)
lib/engine.mjs     N-up paceline physics, grouping, start-sheet, calibration
lib/strava.mjs     Strava OAuth + activity fetch/match
public/            Organiser UI + rider sign-up page (no build step),
                    split into feature modules (state, api, actions,
                    grouping, views)
tests/unit/        Fast tests for pure logic (engine, course parsing,
                    route helpers) — no DB required
tests/integration/ API route tests against a real (Docker) Postgres
```
```

- [ ] **Step 5: Run the full test suite**

Run: `npm run test:all`
Expected: `pass 18` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 6: Commit**

```bash
git add server.js .env.example README.md
git commit -m "refactor: finalize server.js, add .env.example, update README"
```

---

## Task 14: `public/format.js` (pure formatting helpers, unit tested) + `public/state.js`

**Files:**
- Create: `public/format.js`
- Create: `tests/unit/format.test.mjs`
- Create: `public/state.js`

**Interfaces:**
- Produces: `esc`, `fmtDur`, `fmtGap`, `addClock`, `gid` from `public/format.js` (pure, no DOM — used by `public/grouping.js` and `public/views.js`). `POSITIONS`, `BUILDS`, `SHADES`, `app`, `params`, `LS`, `state`, `el`, `ridersById`, `paramsOf`, `segments` from `public/state.js` (DOM/stateful — used by every other frontend module).

`esc`/`fmtDur`/`fmtGap`/`addClock`/`gid` are split into their own module rather than living in `state.js` (as originally sketched) specifically so they can be unit tested in plain Node: `public/state.js` runs `document.getElementById(...)` at the top level, which throws immediately in Node (no DOM) — importing anything from that file in a Node test would crash before any assertion runs. Keeping the pure helpers in a separate DOM-free module sidesteps that entirely.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/format.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { esc, fmtDur, fmtGap, addClock, gid } from "../../public/format.js";

test("esc escapes HTML-significant characters but leaves single quotes alone", () => {
  assert.equal(esc(`<b>"quote" & 'ok'</b>`), `&lt;b&gt;&quot;quote&quot; &amp; 'ok'&lt;/b&gt;`);
});

test("esc treats null/undefined as an empty string", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("fmtDur formats seconds under an hour as m:ss", () => {
  assert.equal(fmtDur(125), "2:05");
});

test("fmtDur formats seconds over an hour as h:mm:ss", () => {
  assert.equal(fmtDur(3725), "1:02:05");
});

test("fmtDur returns an em dash for non-finite input", () => {
  assert.equal(fmtDur(Infinity), "—");
  assert.equal(fmtDur(NaN), "—");
});

test("fmtGap formats a gap as +m:ss", () => {
  assert.equal(fmtGap(95), "+1:35");
});

test("addClock adds seconds to a HH:MM start time", () => {
  assert.equal(addClock("09:30", 125), "09:32:05");
});

test("addClock wraps past midnight", () => {
  assert.equal(addClock("23:50", 900), "00:05:00");
});

test("gid returns a string starting with g followed by hex characters", () => {
  assert.match(gid(), /^g[0-9a-f]+$/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../public/format.js'`.

- [ ] **Step 3: Write `public/format.js`**

Create `public/format.js`:

```javascript
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmtDur = (s) => { if (!Number.isFinite(s)) return "—"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`; };
export const fmtGap = (s) => { s = Math.round(s); return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const addClock = (hhmm, secs) => { const [h, m] = (hhmm || "09:30").split(":").map(Number); const t = h * 3600 + m * 60 + Math.round(secs); return `${String(Math.floor(t / 3600) % 24).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
export const gid = () => "g" + Math.random().toString(16).slice(2, 8);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `pass 27`, `fail 0` (18 from Tasks 1–2, 8 + 9 new).

- [ ] **Step 5: Write `public/state.js`**

Create `public/state.js`:

```javascript
export const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
export const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
export const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
export const app = document.getElementById("app");
export const params = new URLSearchParams(location.search);
export const LS = window.localStorage;

export const state = {
  code: params.get("code") || LS.getItem("pursuit:lastCode") || "",
  token: "",
  signup: params.get("signup") === "1",
  data: null,
  work: { groups: [], unassigned: [] },
  sel: null,
  saveStatus: "",
  ridePicker: null,
  mode: params.get("code") || LS.getItem("pursuit:lastCode") ? "app" : "landing",
  justCreated: null,
  banner: params.get("stravalinked") ? "Strava linked — hit Refine after the ride." : params.get("stravaerror") ? "Strava linking failed." : "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";

export const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

export const ridersById = () => Object.fromEntries((state.data?.riders || []).map((r) => [r.id, { id: r.id, name: r.name, w: r.w, ftp: r.ftp, pos: r.pos, build: r.build, calib: r.calib }]));
export const paramsOf = () => state.data?.event?.params || {};
export const segments = () => state.data?.event?.course?.segments;
```

- [ ] **Step 6: Commit**

```bash
git add public/format.js tests/unit/format.test.mjs public/state.js
git commit -m "refactor: extract public/format.js (tested) and public/state.js"
```

---

## Task 15: Extract `public/api.js`

**Files:**
- Create: `public/api.js`

**Interfaces:**
- Consumes: `state`, `LS` from `public/state.js`; `render` from `public/views.js` (created in Task 18 — see note below).
- Produces: `api`, `syncWork`, `loadEvent`, `setSaveStatus`, `persistGroups`, `savedEvents` — consumed by Tasks 16–19.

Note on ordering: this file imports `render` from `./views.js`, which doesn't exist until Task 18. That's fine — ES modules resolve imports lazily relative to when they're *called*, not when the file is parsed, and nothing in this task executes the code yet (no test runs it; the app isn't reloaded in a browser until Task 19). The app.js entry point still points at the whole (not-yet-fully-split) original code until Task 19 finishes, so this doesn't break anything running today. Each of Tasks 15–18 is verified the same way: `node --check` for a syntax sanity check, and a full manual smoke test once Task 19 wires everything together.

- [ ] **Step 1: Create the module**

Create `public/api.js`:

```javascript
import { state, LS } from "./state.js";
import { render } from "./views.js";

export async function api(path, method = "GET", body, withToken) {
  const headers = { "Content-Type": "application/json" };
  if (withToken) headers["x-organiser-token"] = state.token;
  const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

export function syncWork() {
  const groups = (state.data?.groups || []).map((g) => ({ id: g.id, members: g.members.map(Number), locked: !!g.locked }));
  const inG = new Set(groups.flatMap((g) => g.members));
  const unassigned = (state.data?.riders || []).map((r) => r.id).filter((id) => !inG.has(id));
  state.work = { groups, unassigned }; state.sel = null;
}

export async function loadEvent() {
  if (!state.code) { state.mode = "landing"; render(); return; }
  if (saving) await new Promise((r) => { const t = setInterval(() => { if (!saving) { clearInterval(t); r(); } }, 20); });
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); syncWork(); state.mode = "app"; }
  catch { state.data = null; state.mode = "landing"; state.banner = "Couldn't find event “" + state.code + "”. Check the code, or create a new event."; }
  render();
}

export const setSaveStatus = (t) => { state.saveStatus = t; const s = document.getElementById("savestatus"); if (s) s.textContent = t; };
let saving = false, saveAgain = false;
export async function persistGroups() {
  if (!state.token) return;
  if (saving) { saveAgain = true; return; }            // coalesce rapid edits, always end on latest state
  saving = true; setSaveStatus("Saving…");
  try { await api("/events/" + state.code + "/groups", "PUT", { groups: state.work.groups }, true); setSaveStatus("Saved"); }
  catch (e) { setSaveStatus("Save failed: " + e.message); }
  saving = false;
  if (saveAgain) { saveAgain = false; persistGroups(); }
}

export function savedEvents() {
  const out = [];
  for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith("pursuit:token:")) out.push(k.slice("pursuit:token:".length)); }
  return out;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/api.js`
Expected: no output.

- [ ] **Step 3: Run the unit suite (nothing frontend-related should be affected yet)**

Run: `npm test`
Expected: `pass 27`, `fail 0` — unchanged from Task 14, since `public/app.js` hasn't been repointed to these new modules yet.

- [ ] **Step 4: Commit**

```bash
git add public/api.js
git commit -m "refactor: extract public/api.js"
```

---

## Task 16: Extract `public/actions.js`

**Files:**
- Create: `public/actions.js`

**Interfaces:**
- Consumes: `state`, `LS` from `public/state.js`; `api`, `loadEvent`, `syncWork` from `public/api.js`; `render` from `public/views.js`.
- Produces: `createEvent`, `openExisting`, `toLanding`, `origin`, `detailsMailto`, `copyDetails`, `patchEvent`, `addRider`, `updRider`, `delRider`, `openRidePicker`, `bannerFromRefine`, `applyRefine`, `autoRefine` — consumed by `public/views.js` (Task 18).

- [ ] **Step 1: Create the module**

Create `public/actions.js`:

```javascript
import { state, LS } from "./state.js";
import { api, loadEvent, syncWork } from "./api.js";
import { render } from "./views.js";

export async function createEvent(name, code) {
  try {
    const r = await api("/events", "POST", { name, code });
    state.code = r.event.code; state.token = r.organiserToken;
    LS.setItem("pursuit:token:" + state.code, r.organiserToken);
    state.data = r; syncWork();
    state.justCreated = { code: r.event.code, token: r.organiserToken, name: r.event.name };
    state.mode = "landing"; state.banner = ""; render();
  } catch (e) { alert(e.message); }
}

export function openExisting(code, key) {
  code = (code || "").trim().toLowerCase();
  if (!code) { state.banner = "Enter an event code."; render(); return; }
  state.code = code;
  if (key && key.trim()) { state.token = key.trim(); LS.setItem("pursuit:token:" + code, state.token); }
  else state.token = LS.getItem("pursuit:token:" + code) || "";
  state.banner = ""; loadEvent();
}

export function toLanding() { state.mode = "landing"; state.justCreated = null; state.ridePicker = null; render(); }

export const origin = () => location.origin;

export function detailsMailto(code, token, name) {
  const body = `Your Pursuit event details — keep the organiser key safe, it's the only way to edit this event.\n\n`
    + `Event: ${name}\nCode: ${code}\nOrganiser key: ${token}\n\n`
    + `Manage the event: ${origin()}/?code=${encodeURIComponent(code)}\n`
    + `Rider sign-up link (share this): ${origin()}/?code=${encodeURIComponent(code)}&signup=1\n`;
  return `mailto:?subject=${encodeURIComponent(`Pursuit event: ${name} (${code})`)}&body=${encodeURIComponent(body)}`;
}

export function copyDetails(code, token, name) {
  const text = `Pursuit event: ${name}\nCode: ${code}\nOrganiser key: ${token}\nManage: ${origin()}/?code=${code}\nSign-up: ${origin()}/?code=${code}&signup=1`;
  navigator.clipboard?.writeText(text); state.banner = "Event details copied to the clipboard."; render();
}

export const patchEvent = (body) => api("/events/" + state.code, "PATCH", body, true).then(() => loadEvent()).catch((e) => alert(e.message));
export const addRider = (r) => api("/events/" + state.code + "/riders", "POST", r).then(loadEvent).catch((e) => alert(e.message));
export const updRider = (id, body) => api("/riders/" + id, "PATCH", body, true).then(loadEvent).catch((e) => alert(e.message));
export const delRider = (id) => api("/riders/" + id, "DELETE", null, true).then(loadEvent).catch((e) => alert(e.message));

export async function openRidePicker(id) {
  state.banner = "Loading recent rides…"; render();
  try { const r = await api("/riders/" + id + "/rides", "GET", null, true); state.ridePicker = { riderId: id, rides: r.rides, course: r.course, hideCommutes: true }; state.banner = ""; render(); }
  catch (e) { state.banner = e.message; render(); }
}

export function bannerFromRefine(r) {
  if (!r.matched) return r.message;
  if (r.mode === "power") return `Set FTP from “${r.activity}”: ${r.ftp} W${r.hadPower ? " (power meter)" : " (Strava estimate)"}. Calibration reset.`;
  return `Refined from “${r.activity}” (${r.distanceKm} km): effective FTP ${r.effectiveFtp} W (×${r.calib}).`;
}

export async function applyRefine(id, activityId, mode) {
  state.ridePicker = null; state.banner = "Applying…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { activityId, mode }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

export async function autoRefine(id) {
  state.ridePicker = null; state.banner = "Finding your fastest effort on the course…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { mode: "course" }, true); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/actions.js`
Expected: no output.

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: `pass 27`, `fail 0` — unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/actions.js
git commit -m "refactor: extract public/actions.js"
```

---

## Task 17: Extract `public/grouping.js`

**Files:**
- Create: `public/grouping.js`

**Interfaces:**
- Consumes: `state` from `public/state.js`; `ridersById`, `paramsOf`, `segments` from `public/state.js`; `gid`, `fmtDur`, `fmtGap`, `addClock` from `public/format.js`; `persistGroups` from `public/api.js`; `render` from `public/views.js`; `suggestGroups`, `computeSheet`, `soloDuration` from `/engine.mjs` (served by the backend at that absolute path, same as today).
- Produces: `locate`, `swap`, `moveTo`, `toggleLock`, `breakGroup`, `clearGroups`, `newGroup`, `goSolo`, `joinBest`, `suggestLocal`, `onPick`, `localSheet`, `exportCSV` — consumed by `public/views.js` (Task 18).

- [ ] **Step 1: Create the module**

Create `public/grouping.js`:

```javascript
import { computeSheet, suggestGroups, soloDuration } from "/engine.mjs";
import { state, ridersById, paramsOf, segments } from "./state.js";
import { gid, fmtDur, fmtGap, addClock } from "./format.js";
import { persistGroups } from "./api.js";
import { render } from "./views.js";

export function locate(id) {
  for (const g of state.work.groups) { if (g.locked) continue; const i = g.members.indexOf(id); if (i >= 0) return { gid: g.id, i }; }
  const ui = state.work.unassigned.indexOf(id); if (ui >= 0) return { ui }; return null;
}

export function swap(x, y) {
  if (x === y) return; const lx = locate(x), ly = locate(y); if (!lx || !ly) return;
  const set = (l, id) => { if (l.ui != null) state.work.unassigned[l.ui] = id; else state.work.groups.find((g) => g.id === l.gid).members[l.i] = id; };
  set(lx, y); set(ly, x); state.sel = null; persistGroups(); render();
}

export function moveTo(id, target) {
  if (!locate(id)) return; // locked source
  state.work.groups = state.work.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }));
  state.work.unassigned = state.work.unassigned.filter((m) => m !== id);
  if (target === "unassigned") state.work.unassigned.push(id);
  else { const t = state.work.groups.find((g) => g.id === target); if (!t || t.locked) return; t.members.push(id); }
  state.work.groups = state.work.groups.filter((g) => g.members.length || g.locked);
  state.sel = null; persistGroups(); render();
}

export const toggleLock = (id) => { const g = state.work.groups.find((q) => q.id === id); if (g) g.locked = !g.locked; persistGroups(); render(); };
export const breakGroup = (id) => { const g = state.work.groups.find((q) => q.id === id); if (!g) return; state.work.unassigned.push(...g.members); state.work.groups = state.work.groups.filter((q) => q.id !== id); persistGroups(); render(); };
export const clearGroups = () => { const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members)); state.work.unassigned = (state.data.riders || []).map((r) => r.id).filter((id) => !lockedIds.has(id)); state.work.groups = locked; state.sel = null; persistGroups(); render(); };
export const newGroup = () => { state.work.groups.push({ id: gid(), members: [], locked: false }); persistGroups(); render(); };

export function goSolo(id) {
  state.work.groups = state.work.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })).filter((g) => g.members.length || g.locked);
  state.work.unassigned = state.work.unassigned.filter((m) => m !== id);
  state.work.groups.push({ id: gid(), members: [id], locked: false });
  state.sel = null; state.banner = ""; persistGroups(); render();
}

export function joinBest(id) {
  const seg = segments(), byId = ridersById(), p = paramsOf();
  const cands = state.work.groups.filter((g) => !g.locked && g.members.length);
  if (!cands.length || !seg) return goSolo(id);
  const solo = soloDuration(byId[id], seg, p);
  let best = cands[0], diff = Infinity;
  for (const g of cands) {
    const avg = g.members.reduce((s, m) => s + soloDuration(byId[m], seg, p), 0) / g.members.length;
    const d = Math.abs(avg - solo); if (d < diff) { diff = d; best = g; }
  }
  moveTo(id, best.id);
}

export function suggestLocal(size) {
  const seg = segments(); if (!seg) { alert("Set a course first."); return; }
  const locked = state.work.groups.filter((g) => g.locked); const lockedIds = new Set(locked.flatMap((g) => g.members));
  const pool = state.data.riders.map((r) => r.id).filter((id) => !lockedIds.has(id));
  const { groups, leftover } = suggestGroups(pool, ridersById(), seg, paramsOf(), size);
  state.work.groups = [...locked, ...groups.map((m) => ({ id: gid(), members: m, locked: false }))];
  state.work.unassigned = leftover; state.sel = null;
  if (leftover.length) state.banner = "One rider didn't fill a group — start them solo or add them to the best-matched group below.";
  persistGroups(); render();
}

export const onPick = (id, locked) => { if (locked) return; if (state.sel == null) state.sel = id; else if (state.sel === id) state.sel = null; else return swap(state.sel, id); render(); };

export const localSheet = () => segments() ? computeSheet(state.work.groups, ridersById(), segments(), paramsOf()) : { rows: [], tMax: 0, tMin: 0 };

export function exportCSV(sheet) {
  if (!sheet.rows.length) return;
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const head = ["Seed", "Group", "Riders", "W/kg", "Est", "Gap", "Off gun", "Turn split"];
  const rows = sheet.rows.map((r) => [r.seed, r.members.length + "-up", r.members.map((m) => m.name).join(" · "), r.wkg.toFixed(2), fmtDur(r.dur), r.offset < 0.5 ? "scratch" : fmtGap(r.offset), addClock(state.data.event.firstStart, r.offset), r.members.map((m) => `${m.name} ${Math.round(m.front * 100)}%`).join(" / ")]);
  const csv = [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = state.code + "-start-sheet.csv"; a.click(); URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/grouping.js`
Expected: no output.

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: `pass 27`, `fail 0` — unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/grouping.js
git commit -m "refactor: extract public/grouping.js"
```

---

## Task 18: Extract `public/views.js`

**Files:**
- Create: `public/views.js`

**Interfaces:**
- Consumes: `cdaOf` from `/engine.mjs`; `state`, `app`, `POSITIONS`, `BUILDS`, `SHADES`, `el`, `ridersById` from `public/state.js`; `esc`, `fmtDur`, `fmtGap`, `addClock` from `public/format.js`; `toLanding`, `detailsMailto`, `copyDetails`, `createEvent`, `openExisting`, `patchEvent`, `addRider`, `updRider`, `delRider`, `openRidePicker`, `autoRefine`, `applyRefine`, `origin` from `public/actions.js`; `savedEvents` and `api` from `public/api.js` (`api` is used directly by `renderSignup`); `suggestLocal`, `clearGroups`, `newGroup`, `moveTo`, `toggleLock`, `breakGroup`, `goSolo`, `joinBest`, `onPick`, `localSheet`, `exportCSV` from `public/grouping.js`; `parseCourseFile` from `public/course.js`.
- Produces: `render` — consumed by `public/api.js` (Task 15), `public/grouping.js` (Task 17), `public/actions.js` (Task 16), and `public/app.js` (Task 19).

- [ ] **Step 1: Create the module**

Create `public/views.js`:

```javascript
import { cdaOf } from "/engine.mjs";
import { state, app, POSITIONS, BUILDS, SHADES, el, ridersById } from "./state.js";
import { esc, fmtDur, fmtGap, addClock } from "./format.js";
import { toLanding, detailsMailto, copyDetails, createEvent, openExisting, patchEvent, addRider, updRider, delRider, openRidePicker, autoRefine, applyRefine, origin } from "./actions.js";
import { api, savedEvents } from "./api.js";
import { suggestLocal, clearGroups, newGroup, moveTo, toggleLock, breakGroup, goSolo, joinBest, onPick, localSheet, exportCSV } from "./grouping.js";
import { parseCourseFile } from "./course.js";

/* ---- render -------------------------------------------------------------- */
export function render() {
  if (state.signup) return renderSignup();
  if (state.mode === "landing" || !state.data) return renderLanding();
  const d = state.data, ev = d?.event, origin = location.origin;
  const km = ev?.course ? (ev.course.distanceM / 1000).toFixed(1) : "—", asc = ev?.course ? Math.round(ev.course.ascentM) : "—";
  app.innerHTML = `
    <div class="mast"><div class="rule"></div>
      <div class="mast-row">
        <div><span class="kicker">Group handicap · start sheet</span><h1>THE PURSUIT</h1></div>
        <div class="meta"><div><span>Event</span><b>${esc(state.code || "—")}</b></div><div><span>Riders</span><b>${d?.riders.length ?? "—"}</b></div><div><span>Distance</span><b>${km} km</b></div></div>
      </div><div class="rule"></div>
    </div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="grid"><div class="col" id="left"></div><div class="col" id="right"></div></div>
    <div class="foot">Theoretical times — a planning aid, not a promise. Tune the assumptions to your roads and riders.</div>`;
  const left = document.getElementById("left"), right = document.getElementById("right");

  // Event summary (create/open now happen on the landing screen)
  const canEdit = !!state.token;
  const evPanel = el(`<div class="panel"><div class="panel-hd"><h2>Event</h2><button class="ghost" id="switch">Switch / new</button></div>
    <div class="ev-name">${esc(ev.name)}<span class="ev-code">${esc(state.code)}</span></div>
    ${canEdit
      ? `<div class="keyrow"><span class="keylab">Organiser key</span><code class="keyval">${esc(state.token)}</code></div>
         <div class="row" style="margin-top:8px"><a class="add" id="email">✉ Email me the details</a><button class="ghost" id="copy">Copy details</button></div>`
      : `<div class="row" style="margin-top:8px"><input id="paste-token" placeholder="Paste organiser key to edit" style="flex:1"/><button class="add" id="settoken">Use key</button></div>
         <p class="hint">You're viewing read-only. Paste the organiser key to make changes.</p>`}
  </div>`);
  left.appendChild(evPanel);
  evPanel.querySelector("#switch").onclick = toLanding;
  if (canEdit) {
    evPanel.querySelector("#email").href = detailsMailto(state.code, state.token, ev.name);
    evPanel.querySelector("#copy").onclick = () => copyDetails(state.code, state.token, ev.name);
  } else {
    const st = evPanel.querySelector("#settoken"); if (st) st.onclick = () => { state.token = evPanel.querySelector("#paste-token").value.trim(); LS.setItem("pursuit:token:" + state.code, state.token); render(); };
  }

  // Course (manual + GPX/FIT upload + profile)
  left.appendChild(coursePanel(ev, canEdit, km, asc));

  // Riders
  const rp = el(`<div class="panel"><div class="panel-hd"><h2>Riders</h2><button class="add" id="addr" ${canEdit ? "" : "disabled"}>+ Rider</button></div>
    <div class="linkbox"><input readonly value="${origin}/?code=${encodeURIComponent(state.code)}&signup=1"/><button class="ghost" id="copylink">Copy sign-up link</button></div>
    <p class="hint">Share that link; riders add themselves and appear here.</p><div id="rlist" style="margin-top:10px"></div></div>`);
  left.appendChild(rp);
  rp.querySelector("#copylink").onclick = () => navigator.clipboard?.writeText(`${origin}/?code=${state.code}&signup=1`);
  rp.querySelector("#addr").onclick = () => addRider({ name: "New rider", w: 75, ftp: 240, pos: "road_drops", build: "medium" });
  const rlist = rp.querySelector("#rlist");
  if (!d.riders.length) rlist.innerHTML = `<p class="empty">No riders yet.</p>`;
  d.riders.forEach((r) => rlist.appendChild(riderRow(r, canEdit)));

  // Groups (editable) + start sheet
  const sheet = localSheet();
  right.appendChild(groupsPanel(ev, canEdit, sheet));
  right.appendChild(boardEl(ev, canEdit, sheet));

  if (state.ridePicker) app.appendChild(ridePickerEl());
}

function ridePickerEl() {
  const { riderId, rides, course, hideCommutes } = state.ridePicker;
  const rider = ridersById()[riderId];
  const shown = rides.filter((r) => !(hideCommutes && r.commute));
  const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const overlay = el(`<div class="modal-back"><div class="modal">
    <div class="modal-hd"><div><span class="kicker">Refine from Strava</span><h2>${esc(rider?.name || "Rider")}'s recent rides</h2></div><button class="modal-x" id="close">×</button></div>
    <p class="hint">Pick a real effort — not a commute. <b>Use time</b> calibrates from how fast this ride was over your course (${course.distanceKm ? course.distanceKm + " km" : "no course set"}). <b>FTP from power</b> reads the ride's power as an FTP estimate (best on a 30–60 min hard effort).</p>
    <div class="modal-tools"><button class="btn" id="auto" ${course.distanceKm ? "" : "disabled"}>Auto · fastest effort on course</button>
      <label class="chk"><input type="checkbox" id="hc" ${hideCommutes ? "checked" : ""}/> Hide commutes</label></div>
    <div class="ridelist" id="ridelist"></div>
  </div></div>`);
  overlay.querySelector("#close").onclick = () => { state.ridePicker = null; render(); };
  overlay.onclick = (e) => { if (e.target === overlay) { state.ridePicker = null; render(); } };
  overlay.querySelector("#auto").onclick = () => autoRefine(riderId);
  overlay.querySelector("#hc").onchange = (e) => { state.ridePicker.hideCommutes = e.target.checked; render(); };

  const list = overlay.querySelector("#ridelist");
  if (!shown.length) list.innerHTML = `<p class="empty">No rides in the last 6 weeks${hideCommutes ? " (commutes hidden)" : ""}.</p>`;
  shown.forEach((rd) => {
    const power = rd.weightedWatts != null ? `${rd.weightedWatts} W · meter` : rd.avgWatts != null ? `${rd.avgWatts} W · est` : "no power";
    const card = el(`<div class="ridecard ${rd.matches ? "match" : ""}">
      <div class="ride-main"><b>${esc(rd.name)}</b><span class="ride-sub">${shortDate(rd.date)} · ${rd.distanceKm} km · ${fmtDur(rd.movingTime)} · ${rd.avgSpeedKmh} km/h · ${power}</span></div>
      <div class="ride-tags">${rd.matches ? `<span class="tg tg-match">matches course${rd.impliedCalib ? ` · ×${rd.impliedCalib}` : ""}</span>` : ""}${rd.commute ? `<span class="tg tg-com">commute</span>` : ""}${rd.hasPower ? `<span class="tg tg-pow">power meter</span>` : ""}</div>
      <div class="ride-acts">
        <button class="add usetime" ${rd.matches ? "" : "disabled"} title="${rd.matches ? "Calibrate from this ride's time on the course" : "Only for rides that match the course distance"}">Use time</button>
        <button class="add usepow" ${rd.avgWatts != null || rd.weightedWatts != null ? "" : "disabled"} title="Set FTP from this ride's power">FTP from power</button>
      </div></div>`);
    card.querySelector(".usetime").onclick = () => applyRefine(riderId, rd.id, "course");
    card.querySelector(".usepow").onclick = () => applyRefine(riderId, rd.id, "power");
    list.appendChild(card);
  });
  return overlay;
}

function coursePanel(ev, canEdit, km, asc) {
  const cs = el(`<div class="panel"><div class="panel-hd"><h2>Course</h2></div>
    <div class="drop" id="drop" tabindex="0" role="button"><b>Drop a GPX or FIT — or tap to choose</b><span>Strava route → Export GPX, or a Wahoo/Garmin .fit off the head unit.</span></div>
    <input type="file" id="file" accept=".gpx,.fit" hidden/>
    <p class="err" id="cerr" style="display:none"></p>
    <div class="two" style="margin-top:12px"><label class="f">Distance (km)<input type="number" id="km" value="${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : 45}"/></label><label class="f">Total ascent (m)<input type="number" id="asc" value="${ev.course ? Math.round(ev.course.ascentM) : 500}"/></label></div>
    <div class="row" style="margin-top:10px"><button class="add" id="savecourse" ${canEdit ? "" : "disabled"}>Save manual course</button><span class="hint">${ev.course ? `${esc(ev.course.name || "Course")} · ${km} km · ${asc} m` : "no course set"}</span></div>
    <div id="prof"></div></div>`);
  const drop = cs.querySelector("#drop"), file = cs.querySelector("#file"), cerr = cs.querySelector("#cerr");
  const doFile = async (f) => { if (!canEdit) { alert("Paste the organiser key first."); return; } cerr.style.display = "none"; try { const course = await parseCourseFile(f); await patchEvent({ course }); } catch (e) { cerr.textContent = e.message; cerr.style.display = "block"; } };
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => e.key === "Enter" && file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("drag"); if (e.dataTransfer.files[0]) doFile(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && doFile(file.files[0]);
  cs.querySelector("#savecourse").onclick = () => patchEvent({ courseManual: { km: cs.querySelector("#km").value, ascent: cs.querySelector("#asc").value } });
  if (ev.course?.profile) cs.querySelector("#prof").appendChild(profileSvg(ev.course.profile));
  return cs;
}

function groupsPanel(ev, canEdit, sheet) {
  const metrics = Object.fromEntries(sheet.rows.map((r) => [r.gid, r]));
  const gp = el(`<div class="panel"><div class="panel-hd"><h2>Pursuit groups</h2>
    <div class="row"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Size<span class="stepper"><button id="dec">−</button><b id="gs">${ev.groupSize}</b><button id="inc">+</button></span></label><button class="btn" id="suggest" ${canEdit ? "" : "disabled"}>Suggest</button></div>
  </div>
  <div class="row" style="margin-bottom:10px">${canEdit ? `<button class="ghost" id="clear">Clear</button><button class="ghost" id="new">+ Empty group</button>` : ""}<span class="hint">Tap a rider, then another, to swap · <span id="savestatus">${esc(state.saveStatus)}</span></span></div>
  <div id="groups" class="groups"></div><div id="bench"></div>
  ${state.sel ? `<p class="swaphint">Selected <b>${esc(ridersById()[state.sel]?.name || "rider")}</b> — tap another to swap, or "+ here" to move.</p>` : ""}
  </div>`);
  let size = ev.groupSize; const gsEl = gp.querySelector("#gs");
  gp.querySelector("#dec").onclick = () => { size = Math.max(1, size - 1); gsEl.textContent = size; };
  gp.querySelector("#inc").onclick = () => { size = Math.min(8, size + 1); gsEl.textContent = size; };
  gp.querySelector("#suggest").onclick = () => suggestLocal(size);
  const clr = gp.querySelector("#clear"); if (clr) clr.onclick = clearGroups;
  const ng = gp.querySelector("#new"); if (ng) ng.onclick = newGroup;

  const gwrap = gp.querySelector("#groups");
  if (!state.work.groups.length) gwrap.innerHTML = `<p class="empty">Set a group size and tap <b>Suggest</b> to tier riders by ability, then tweak by hand.</p>`;
  state.work.groups.forEach((g) => gwrap.appendChild(groupCard(g, metrics[g.id], canEdit)));

  if (state.work.unassigned.length) {
    const bench = el(`<div class="benchbox"><div class="bench-hd">Unassigned riders</div>
      <p class="hint">Left over from the groups? Start them solo, or drop them into the best-matched group.</p>
      ${state.sel != null && canEdit ? `<div style="margin:8px 0"><button class="movein" id="benchhere">＋ move selected here</button></div>` : ""}
      <div class="bench" id="benchrow"></div></div>`);
    const row = bench.querySelector("#benchrow");
    const bh = bench.querySelector("#benchhere"); if (bh) bh.onclick = () => moveTo(state.sel, "unassigned");
    state.work.unassigned.forEach((id) => {
      const r = ridersById()[id]; if (!r) return;
      const item = el(`<div class="benchrider"></div>`);
      item.appendChild(chip(r, false));
      if (canEdit) {
        const solo = el(`<button class="ghost mini" title="Start as a one-rider pursuit">Go solo</button>`); solo.onclick = () => goSolo(id);
        const join = el(`<button class="ghost mini" title="Add to the group closest in ability">Join best group</button>`); join.onclick = () => joinBest(id);
        item.appendChild(solo); item.appendChild(join);
      }
      row.appendChild(item);
    });
    gp.querySelector("#bench").appendChild(bench);
  }
  return gp;
}

function groupCard(g, m, canEdit) {
  const members = g.members.map((id) => ridersById()[id]).filter(Boolean);
  const quality = m?.quality || (members.length <= 1 ? "Solo" : "—");
  const wkg = m ? m.wkg.toFixed(2) : members.length ? (members.reduce((s, r) => s + r.ftp, 0) / members.reduce((s, r) => s + r.w, 0)).toFixed(2) : "—";
  const card = el(`<div class="grpcard ${g.locked ? "locked" : ""}">
    <div class="gc-top"><span class="gc-size">${members.length}-up</span><span class="quality q-${quality.toLowerCase()}">${quality}</span><span class="gc-wkg">${wkg} W/kg</span>
      <span class="gc-actions">${canEdit && state.sel != null && !g.locked ? `<button class="movein">+ here</button>` : ""}${canEdit ? `<button class="lock">${g.locked ? "🔒" : "🔓"}</button><button class="unpair">×</button>` : ""}</span></div>
    <div class="turnbar">${m ? m.members.map((mm, i) => `<span style="width:${(mm.front * 100).toFixed(1)}%;background:${SHADES[i % SHADES.length]}"></span>`).join("") : ""}</div>
    <div class="gc-riders"></div></div>`);
  const mi = card.querySelector(".movein"); if (mi) mi.onclick = () => moveTo(state.sel, g.id);
  const lk = card.querySelector(".lock"); if (lk) lk.onclick = () => toggleLock(g.id);
  const up = card.querySelector(".unpair"); if (up) up.onclick = () => breakGroup(g.id);
  const rr = card.querySelector(".gc-riders");
  if (!members.length) rr.innerHTML = `<p class="empty" style="padding:4px">empty — move riders here</p>`;
  members.forEach((r, i) => rr.appendChild(chip(r, g.locked, m ? Math.round(m.members[i].front * 100) : null)));
  return card;
}

function chip(r, locked, lead) {
  const wkg = (r.ftp / (r.w + 8)).toFixed(2);
  const c = el(`<button class="chip ${state.sel === r.id ? "sel" : ""} ${locked ? "chip-lock" : ""}">
    <span class="chip-name">${esc(r.name)}</span><span class="chip-sub">${wkg} W/kg · ${cdaOf(r).toFixed(2)}${lead != null ? ` · ${lead}%` : ""}</span></button>`);
  c.disabled = locked && state.sel && state.sel !== r.id;
  c.onclick = () => onPick(r.id, locked);
  return c;
}

function riderRow(r, canEdit) {
  const wkg = (r.ftp / (r.w + 8)).toFixed(2);
  const row = el(`<div class="rr">
    <input class="rr-name" value="${esc(r.name)}" placeholder="Rider name" ${canEdit ? "" : "disabled"}/>
    <div class="rr-ctrl">
      <label class="rf"><span>kg</span><input type="number" class="w" value="${r.w}" ${canEdit ? "" : "disabled"}/></label>
      <label class="rf"><span>FTP·W</span><input type="number" class="ftp" value="${r.ftp}" ${canEdit ? "" : "disabled"}/></label>
      <label class="rf"><span>Bike</span><select class="pos" ${canEdit ? "" : "disabled"}>${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === r.pos ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="rf"><span>Build</span><select class="build" ${canEdit ? "" : "disabled"}>${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === r.build ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      ${canEdit ? `<button class="del" title="Remove">×</button>` : ""}</div>
    <div class="rr-tools"><span class="pill ${r.strava ? "on" : "off"}">${r.strava ? "Strava linked" : "No Strava"}</span>
      <span class="micro">${wkg} W/kg${r.calib && r.calib !== 1 ? ` · cal ×${r.calib.toFixed(2)}` : ""}</span>
      ${canEdit ? `<a class="ghost" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${r.id}">${r.strava ? "Re-link" : "Link Strava"}</a>` : ""}
      ${canEdit && r.strava ? `<button class="ghost refine">Refine</button>` : ""}</div></div>`);
  if (canEdit) {
    const save = () => updRider(r.id, { name: row.querySelector(".rr-name").value, w: +row.querySelector(".w").value, ftp: +row.querySelector(".ftp").value, pos: row.querySelector(".pos").value, build: row.querySelector(".build").value });
    row.querySelector(".rr-name").onblur = save;
    row.querySelectorAll(".w,.ftp,.pos,.build").forEach((i) => (i.onchange = save));
    row.querySelector(".del").onclick = () => confirm(`Remove ${r.name}?`) && delRider(r.id);
    const rf = row.querySelector(".refine"); if (rf) rf.onclick = () => openRidePicker(r.id);
  }
  return row;
}

function boardEl(ev, canEdit, sheet) {
  const b = el(`<div class="board">
    <div class="printhead"><b>${esc(ev.name)}</b><span>${esc(state.code)} · ${ev.course ? (ev.course.distanceM / 1000).toFixed(1) : "—"} km · first gun ${esc(ev.firstStart)}</span></div>
    <div class="board-hd"><div><span class="kicker">Start sheet</span><h2>Roll-off order</h2></div>
      <div><label class="gun">First gun<input type="time" id="gun" value="${esc(ev.firstStart)}" ${canEdit ? "" : "disabled"}/></label>${sheet.rows.length ? `<div class="exports"><button class="ghost light" id="csv">CSV</button><button class="ghost light" id="print">Print</button></div>` : ""}</div></div>
    ${sheet.rows.length ? `<div class="conv"><span>Predicted catch</span><b>${fmtDur(sheet.tMax)}</b><span>after first gun · window ${fmtDur(sheet.tMax - sheet.tMin)}</span></div>
      <table><thead><tr><th>Seed</th><th>Group</th><th class="num">W/kg</th><th class="num">Est.</th><th class="num">Gap</th><th class="num">Off gun</th></tr></thead><tbody>
      ${sheet.rows.map((r) => `<tr><td class="seed">${r.seed}</td>
        <td class="grp"><b>${r.members.map((m) => esc(m.name)).join(" · ")}<span class="quality q-${r.quality.toLowerCase()}">${r.quality}</span></b>
          <div class="turnbar">${r.members.map((m, i) => `<span style="width:${(m.front * 100).toFixed(1)}%;background:${SHADES[i % SHADES.length]}"></span>`).join("")}</div></td>
        <td class="num">${r.wkg.toFixed(2)}</td><td class="num">${fmtDur(r.dur)}</td><td class="num gap">${r.offset < 0.5 ? "scratch" : fmtGap(r.offset)}</td><td class="num">${addClock(ev.firstStart, r.offset)}</td></tr>`).join("")}
      </tbody></table>
      <p class="note">Seed 1 rolls off at the gun; each faster group leaves on its gap so all converge at the catch. The bar shows each rider's share of the front.</p>`
      : `<p class="empty">Make some groups to seed the start times.</p>`}</div>`);
  const gun = b.querySelector("#gun"); if (gun && canEdit) gun.onchange = () => patchEvent({ firstStart: gun.value });
  const csv = b.querySelector("#csv"); if (csv) csv.onclick = () => exportCSV(sheet);
  const pr = b.querySelector("#print"); if (pr) pr.onclick = () => window.print();
  return b;
}

function profileSvg(profile) {
  const W = 320, H = 60, pad = 2; const d0 = profile[0].d, maxD = (profile[profile.length - 1].d - d0) || 1;
  const eles = profile.map((p) => p.ele), lo = Math.min(...eles), hi = Math.max(...eles), span = hi - lo || 1;
  const x = (d) => pad + ((d - d0) / maxD) * (W - 2 * pad), y = (e) => H - pad - ((e - lo) / span) * (H - 2 * pad - 6);
  let dd = `M ${x(d0)} ${H} `; profile.forEach((p) => (dd += `L ${x(p.d).toFixed(1)} ${y(p.ele).toFixed(1)} `)); dd += `L ${x(profile[profile.length - 1].d)} ${H} Z`;
  const svg = el(`<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${dd}"/></svg>`);
  return svg;
}

/* ---- landing / entry gate ------------------------------------------------ */
function renderLanding() {
  if (state.justCreated) return renderCreated();
  const recents = savedEvents();
  app.innerHTML = `<div class="landing">
    <div class="rule"></div>
    <div class="land-head"><span class="kicker">Group handicap · start sheet</span><h1>THE PURSUIT</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <p class="land-intro">Slower groups roll off first, faster groups chase, everyone converges in one bunch. Create an event, share the sign-up link, and let the app seed the start times.</p>
    <div class="gate">
      <div class="gate-card">
        <span class="gate-kick">Start here</span><h2>Create a new event</h2>
        <p class="hint gate-lead">You'll get an organiser key — the one thing you need to manage it later.</p>
        <label class="f">Event name<input id="c-name" placeholder="e.g. Condors Summer Pursuit"/></label>
        <label class="f">Custom code <span class="opt">optional</span><input id="c-code" placeholder="auto if left blank"/></label>
        <button class="btn block" id="create">Create event</button>
      </div>
      <div class="gate-card alt">
        <span class="gate-kick">Coming back</span><h2>Open an existing event</h2>
        <p class="hint gate-lead">Enter the code. Add the organiser key to make changes, or leave it blank to just view.</p>
        <label class="f">Event code<input id="o-code" placeholder="event-code"/></label>
        <label class="f">Organiser key <span class="opt">optional — for editing</span><input id="o-key" placeholder="paste key"/></label>
        <button class="add block" id="open">Open event</button>
      </div>
    </div>
    ${recents.length ? `<div class="recents"><span class="rec-lab">Your events on this device</span><div class="rec-list">${recents.map((c) => `<button class="rec" data-code="${esc(c)}">${esc(c)} ›</button>`).join("")}</div></div>` : ""}
    <p class="land-foot">Are you a rider? Use the sign-up link your organiser sent you.</p>
  </div>`;
  document.getElementById("create").onclick = () => createEvent(document.getElementById("c-name").value || "Pursuit", document.getElementById("c-code").value);
  document.getElementById("open").onclick = () => openExisting(document.getElementById("o-code").value, document.getElementById("o-key").value);
  app.querySelectorAll(".rec").forEach((b) => (b.onclick = () => openExisting(b.dataset.code)));
}

function renderCreated() {
  const { code, token, name } = state.justCreated;
  app.innerHTML = `<div class="landing"><div class="rule"></div>
    <div class="land-head"><span class="kicker" style="color:#1f7a4d">Event created</span><h1>${esc(name)}</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="created">
      <p class="hint">Save these now. The <b>organiser key</b> is the only way to edit this event — there's no password reset.</p>
      <div class="cr-field"><span>Event code</span><code>${esc(code)}</code></div>
      <div class="cr-field key"><span>Organiser key</span><code>${esc(token)}</code></div>
      <div class="row" style="margin:6px 0 4px"><a class="btn" id="email">✉ Email me the details</a><button class="add" id="copy">Copy details</button></div>
      <div class="cr-field"><span>Rider sign-up link</span><input readonly value="${origin()}/?code=${encodeURIComponent(code)}&signup=1"/></div>
      <button class="btn block" id="go" style="margin-top:12px">Continue to event ›</button>
    </div>
    <p class="land-foot">Tip: email the details to yourself so you can get back in from any device.</p>
  </div>`;
  document.getElementById("email").href = detailsMailto(code, token, name);
  document.getElementById("copy").onclick = () => { copyDetails(code, token, name); };
  document.getElementById("go").onclick = () => { state.justCreated = null; state.mode = "app"; state.banner = ""; render(); };
}

/* ---- rider self sign-up -------------------------------------------------- */
function renderSignup() {
  app.innerHTML = `<div class="center">
    <a class="ghost" href="/?code=${encodeURIComponent(state.code)}" style="align-self:flex-start">‹ Organiser view</a>
    <span class="kicker">Rider sign-up</span><h1 class="su-title">ADD YOUR DETAILS</h1>
    <label class="f">Event code<input id="code" value="${esc(state.code)}"/></label>
    <label class="f">Name<input id="name" placeholder="Your name"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="w" value="75"/></label><label class="f">FTP (W)<input type="number" id="ftp" value="240"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label></div>
    <p class="micro">Not sure of your FTP? Your best hour-power guess is fine.</p>
    <button class="btn block" id="send">Send to organiser</button><p class="hint" id="status"></p></div>`;
  document.getElementById("send").onclick = async () => {
    const code = document.getElementById("code").value.trim().toLowerCase();
    const body = { name: document.getElementById("name").value, w: +document.getElementById("w").value, ftp: +document.getElementById("ftp").value, pos: document.getElementById("pos").value, build: document.getElementById("build").value };
    const status = document.getElementById("status");
    if (!body.name.trim()) { status.textContent = "Add your name first."; return; }
    status.textContent = "Sending…";
    try { await api("/events/" + encodeURIComponent(code) + "/riders", "POST", body); status.textContent = `Thanks ${body.name} — you're in. You can close this.`; }
    catch (e) { status.textContent = e.message; }
  };
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/views.js`
Expected: no output.

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: `pass 27`, `fail 0` — unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/views.js
git commit -m "refactor: extract public/views.js"
```

---

## Task 19: Trim `public/app.js` to an entry point + manual smoke test

**Files:**
- Modify: `public/app.js`

**Interfaces:** none — this is the final wiring step. After this task, every frontend module from Tasks 14–18 is actually loaded and exercised by the running app for the first time.

- [ ] **Step 1: Replace `public/app.js` with the thin entry point**

Replace the entire contents of `public/app.js` with:

```javascript
/* The Pursuit — organiser + rider-signup frontend.
   Runs the shared engine in the browser for instant feedback while persisting
   arrangements to the API, so results match the standalone app and every client. */
import { state } from "./state.js";
import { loadEvent } from "./api.js";
import { render } from "./views.js";

if (state.signup) render();
else if (state.code) loadEvent();
else render();
```

- [ ] **Step 2: Run the full automated test suite**

Run: `npm run test:all`
Expected: `pass 27` (unit) then `pass 16` (integration), `fail 0` overall.

- [ ] **Step 3: Manual smoke test against a real running server**

This is the step that actually proves the frontend split works end-to-end in a browser — nothing automated exercises `public/*.js` as loaded ES modules. You need a Postgres reachable via `DATABASE_URL` for this (the Docker one from Task 4 works fine if you leave it running: `docker compose up -d test-db`, then use `DATABASE_URL=postgres://pursuit_test:pursuit_test@localhost:5433/pursuit_test` — note in PowerShell that's `$env:DATABASE_URL="postgres://pursuit_test:pursuit_test@localhost:5433/pursuit_test"`).

Run: `$env:DATABASE_URL="postgres://pursuit_test:pursuit_test@localhost:5433/pursuit_test"; node server.js`

Then in a browser, open `http://localhost:3000` and walk through:
1. Create a new event — confirm you land on the "Event created" screen with a code and organiser key, and "Continue to event" takes you into the app.
2. Add 4–6 riders from the Riders panel (name, weight, FTP, bike position, build) — confirm each appears in the rider list immediately.
3. Set a manual course (distance + ascent) and hit **Suggest** with a group size of 2 — confirm groups form and a start sheet with seed order, gaps, and off-gun times appears on the right.
4. Drag/tap-select two riders to swap them between groups — confirm the swap updates instantly and "Saving… / Saved" appears next to the swap hint.
5. Lock a group, then hit **Suggest** again — confirm the locked group is left untouched.
6. Click **CSV** — confirm a `.csv` file downloads with the start sheet.
7. Open the rider sign-up link (`?code=<code>&signup=1`) in a new tab — confirm the public sign-up form works and the new rider appears back on the organiser screen after a refresh.
8. Open dev tools' Network tab and confirm no 404s for `state.js`, `format.js`, `api.js`, `actions.js`, `grouping.js`, `views.js`, `course.js`, or `/engine.mjs`.

If every one of those checks passes, the frontend split is behavior-identical to the pre-refactor app.

- [ ] **Step 4: Stop the manual test server and the Docker test DB**

Press `Ctrl+C` in the terminal running `node server.js`, then:

Run: `docker compose down`

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "refactor: trim public/app.js to a thin entry point"
```

---

## Self-Review

**Spec coverage:**
- Reliability (async error handling) → Task 8 (`asyncRoute` + error middleware), used by every router extracted in Tasks 9–12. ✅
- Duplication/dead code removal (`matchByDistance`, `pool` import, the 4x duplicated rider-shaping literal) → Task 12 (dead export), Task 13 (unused `pool`/other imports swept), Task 8/9–12 (`publicRider`/`engineRider` consolidation). ✅
- Navigable file layout (backend `routes/*.js`, frontend feature modules) → Tasks 9–13 (backend), 14–19 (frontend). ✅
- `.env.example` → Task 13. ✅
- README file-tree update → Task 13. ✅
- Automated test suite: unit (engine, course parsing, helpers, format) → Tasks 1, 2, 8, 14. Integration (events, riders, groups, auth) against Docker Postgres → Tasks 4–7. `npm test` / `test:integration` / `test:all` scripts → Tasks 1, 4. ✅
- No new dependencies, no build step, no behavior change → verified throughout (every extraction task ends with the same test-count assertion; Task 19's manual smoke test is the final behavioral check). ✅

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.

**Type/name consistency check:** traced every cross-file import against the exporting file's actual exports —`routes/helpers.js`'s 16 exports (Task 8) against their use in Tasks 9–12; `public/format.js`'s 5 exports and `public/state.js`'s 11 exports (Task 14) against their use in Tasks 15–18; `public/api.js`'s 6 exports (Task 15), `public/actions.js`'s 14 exports (Task 16), and `public/grouping.js`'s 13 exports (Task 17) against their use in `public/views.js` (Task 18). All match (a few exports — e.g. `params` from `state.js`, `locate`/`swap` from `grouping.js` — have no consumer outside their own module; harmless, not a correctness issue).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-code-quality-refactor.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
