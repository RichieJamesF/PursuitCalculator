# Rider Self-Service & FTP-Only Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every rider their own key so they can edit their details and run their own Strava refinement without the organiser, and replace the untrustworthy time-based calibration with a single FTP-from-power path that suggests the right ride for them.

**Architecture:** Three connected changes. (1) `lib/engine.mjs` loses `calibrationFactor` and every rider's stored `calib` is reset to `1` — the model is driven by FTP alone. (2) `routes/strava.js` is rebuilt around one refinement mode: read a ride's power as an FTP, guarded by a 20-minute minimum, with a server-side "hardest recent effort" pick that both the ride list and the auto-refine share so they can never disagree. (3) A new `riders.rider_token` mints at sign-up and is checked by a new `requireRiderOrOrg` helper, which gates the rider's own PATCH/DELETE and all three Strava routes — closing the existing hole where `GET /auth/strava` had no auth check at all.

**Tech Stack:** Node ≥18.2, Express 4, Postgres (`pg`), native ES modules front and back, `node:test` + `node:assert/strict`, `embedded-postgres` for integration tests.

## Global Constraints

- **No new runtime dependencies.** The app depends on only `express` and `pg`. Tests may use the existing `embedded-postgres` devDependency only.
- **No frontend build step.** `public/` stays plain files served as-is, native ES modules via `<script type="module">` and plain `import`/`export`.
- **Node `>=18.2`** (per `package.json` `engines`). Use global `fetch`, no polyfills.
- **Test commands:** `npm test` runs `node --test tests/unit/*.test.mjs`. `npm run test:integration` runs `node scripts/test-integration.mjs`. `npm run test:all` runs both.
- **Minimum effort duration is 1200 seconds (20 minutes)**, defined once as `MIN_EFFORT_SECONDS` in `routes/strava.js` and never re-hardcoded elsewhere. User-facing copy says "20 minutes".
- **Strava freshness window stays 6 weeks** (`42 * 864e5` ms), matching today's behaviour.
- **`calib` stays in the schema and in the engine's `powerOf`**, permanently `1`. Do not remove the column or change the physics formula — see `docs/adr/0001-strava-refinement-ftp-only.md`.
- **Never return `rider_token` from `publicRider`.** `GET /api/events/:code` is unauthenticated and returns every rider; a leak there defeats the whole mechanism.
- **Governing decisions:** `docs/adr/0001-strava-refinement-ftp-only.md`, `docs/adr/0002-drop-per-event-physics-tuning.md`, `docs/adr/0003-rider-self-service-via-rider-key.md`. Terms in `CONTEXT.md`.

## Already done before this plan (do not redo)

These landed during the audit that produced this plan. They are listed so no task duplicates them:

- `public/views.js` footer copy no longer promises "Tune the assumptions to your roads and riders" (ADR-0002).
- `public/views.js` sign-up `<select>`s now carry explicit `selected` on `road_drops` and `medium`, so a rider who touches neither dropdown is no longer silently modelled as the smallest/least-aero option.
- `CONTEXT.md` and `docs/adr/0001`–`0003` exist.

## Accepted trade-off worth knowing before you start

A rider key travels in a URL (`/?code=EVENT&rider=ID&key=RIDERKEY`) so a rider can get back in from a different device, and as a `key=` query param on `/auth/strava` because a plain `<a href>` navigation cannot carry a custom header. Keys therefore appear in browser history and server access logs. This is accepted and consistent with how the app already shares event sign-up links; a rider key grants edit rights over exactly one rider row and nothing else. Do not "fix" this by inventing sessions or cookies.

## File Structure

| File | Change | Responsibility after the change |
| --- | --- | --- |
| `schema.sql` | Modify | Adds `rider_token` idempotently; resets every `calib` to `1` on boot. |
| `lib/engine.mjs` | Modify | Physics + grouping + sheet only. `calibrationFactor` gone. |
| `routes/helpers.js` | Modify | Adds `getRider` (with a numeric-id guard) and `requireRiderOrOrg`; `eventForRider` gains the same guard. |
| `routes/riders.js` | Modify | Mints `rider_token` at sign-up and returns it once; PATCH/DELETE accept a rider key or the organiser key. |
| `routes/strava.js` | Rewrite | One refinement mode (FTP from power) with a duration guard, a shared `pickSuggested`, and auth on every route. |
| `public/state.js` | Modify | Holds `riderId`/`riderKey`, the `pursuit:riderkey:*` localStorage key, and `mode: "rider"`. |
| `public/api.js` | Modify | `api()` can send `x-rider-token` instead of `x-organiser-token`. |
| `public/actions.js` | Modify | Sign-up now captures the rider key; refine actions thread an auth mode; `bannerFromRefine` loses `mode`. |
| `public/views.js` | Modify | Sign-up confirmation screen, new rider self-service page, reworked ride picker. |
| `tests/unit/engine.test.mjs` | Modify | Drops the `calibrationFactor` test. |
| `tests/unit/strava.test.mjs` | Create | Unit tests for `rideFtpWatts`, `normalizeRide`, `pickSuggested`, `sortRides`. |
| `tests/unit/helpers.test.mjs` | Modify | Adds `requireRiderOrOrg` tests. |
| `tests/integration/riders.test.mjs` | Modify | Rider-key minting, no-leak, and rider-key auth round-trips. |
| `tests/integration/strava.test.mjs` | Create | Auth enforcement on the Strava routes (no live Strava calls). |
| `README.md` | Modify | Accurate API list, refinement description, rider-key flow. |

---

### Task 1: Remove time-based calibration and reset stored `calib`

**Files:**
- Modify: `lib/engine.mjs:99-113` (delete the `calibrationFactor` block)
- Modify: `schema.sql` (append the reset statement)
- Modify: `tests/unit/engine.test.mjs:1-6` (imports) and `:84-94` (delete the test)
- Test: `tests/integration/events.test.mjs` (add one test for the boot-time reset)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `lib/engine.mjs` no longer exports `calibrationFactor`. Task 3 must not import it.

- [ ] **Step 1: Write the failing integration test for the boot-time `calib` reset**

Add to the end of the `describe("events routes", ...)` block in `tests/integration/events.test.mjs`, and add `initDb` and `q` to its imports so the top of the file reads:

```js
import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, stopTestServer, closePool } from "./helpers.mjs";
import { initDb, q } from "../../db.js";
```

```js
  test("running the schema resets any leftover calibration multiplier to 1", async () => {
    await fetch(`${ctx.baseUrl}/api/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Calib reset", code: "calib-reset" }),
    });
    await fetch(`${ctx.baseUrl}/api/events/calib-reset/riders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Legacy" }),
    });
    // 1.25 is exactly representable in float4, so the REAL column round-trips it
    // without the surprise you'd get from e.g. 1.4
    await q("UPDATE riders SET calib=1.25");
    assert.equal((await q("SELECT calib FROM riders")).rows[0].calib, 1.25);

    await initDb();

    assert.equal((await q("SELECT calib FROM riders")).rows[0].calib, 1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — the assertion after `initDb()` reports `1.4` because `schema.sql` does not reset `calib` yet.

- [ ] **Step 3: Add the reset to `schema.sql`**

Append to the end of `schema.sql`:

```sql
-- Calibration is retired (ADR-0001): FTP alone drives the model. Nothing writes a
-- non-1 value any more, so this idempotently clears multipliers left by the old
-- time-based "Use time" refinement.
UPDATE riders SET calib = 1 WHERE calib <> 1;
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Delete `calibrationFactor` from the engine**

In `lib/engine.mjs`, delete this entire block (the comment header and the function):

```js
/* ---- Strava calibration --------------------------------------------------
   After a ride we know the actual moving time over (approximately) the course.
   Find the power multiplier k that makes the model reproduce that time, and
   store it on the rider so future predictions match their real form/aero. */
export function calibrationFactor(rider, segments, actualSeconds, p, prevK = 1) {
  const dur = (k) => groupResult([{ ...rider, calib: k }], segments, p).dur;
  // model time decreases as k rises → bisection on k
  let lo = 0.4, hi = 2.5;
  if (dur(hi) > actualSeconds) return hi; // even at max, model slower than actual
  if (dur(lo) < actualSeconds) return lo;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dur(m) > actualSeconds) lo = m; else hi = m; }
  const k = (lo + hi) / 2;
  // light smoothing against the previous calibration to avoid one-ride swings
  return prevK ? 0.6 * k + 0.4 * prevK : k;
}
```

Also update the file's header comment (line 3) from:

```js
   N-up rotating-paceline physics, ability grouping, and Strava calibration.
```

to:

```js
   N-up rotating-paceline physics, ability grouping, and start-sheet seeding.
```

And update the `powerOf` comment on line 23 from:

```js
// Effective sustainable power for a rider: FTP × effort × personal calibration.
```

to:

```js
// Effective sustainable power for a rider. calib is retired (ADR-0001) and always 1;
// the term stays so stored rows and the formula keep the same shape.
```

- [ ] **Step 6: Delete the engine unit test for it**

In `tests/unit/engine.test.mjs`, remove `calibrationFactor` from the import list so it reads:

```js
import {
  DEFAULT_PARAMS, buildManualCourse, suggestGroups, computeSheet,
  soloDuration, evenness, cdaOf,
} from "../../lib/engine.mjs";
```

Then delete this whole test:

```js
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

`soloDuration` is still imported and used by other tests — leave it in the import list.

- [ ] **Step 7: Prove nothing still references it**

Run: `git grep -n "calibrationFactor"`
Expected: matches **only** in `docs/` (the ADR and the older plan/spec files). Zero matches in `lib/`, `routes/`, `public/`, or `tests/`.

Note: `routes/strava.js` still imports `calibrationFactor` at this point and would now be broken, so fix it in this task — the tree must never be left un-runnable between commits. In `routes/strava.js`, delete this import line:

```js
import { calibrationFactor } from "../lib/engine.mjs";
```

Then delete this line from `normalizeRide` entirely:

```js
  const impliedCalib = matches && segments ? Number(calibrationFactor(rider, segments, a.moving_time, params, rider.calib).toFixed(3)) : null;
```

and drop `impliedCalib` from the object that function returns, so its last property line reads:

```js
    hasPower: !!a.device_watts, commute: !!a.commute, matches,
```

Leave the rest of `normalizeRide` alone — Task 2 replaces the whole function. `public/views.js` reads `rd.impliedCalib`, which now arrives `undefined` and renders as nothing; that dangling read is removed in Task 10. Do **not** introduce a placeholder variable to keep the field alive.

- [ ] **Step 8: Run the full suite**

Run: `npm run test:all`
Expected: PASS. Unit tests report one fewer test than before; integration tests include the new reset test.

- [ ] **Step 9: Commit**

```bash
git add lib/engine.mjs schema.sql routes/strava.js tests/unit/engine.test.mjs tests/integration/events.test.mjs
git commit -m @'
refactor: retire time-based calibration (ADR-0001)

Remove calibrationFactor from the engine and reset every stored calib to 1
on boot. A back-solved power multiplier could not tell a stable rider trait
from that day's chosen effort, and modelled every ride as solo so real-world
drafting inflated it. FTP alone drives the model now.
'@
```

---

### Task 2: Rebuild the Strava ride model around FTP-from-power

**Files:**
- Modify: `routes/strava.js` (replace `normalizeRide`, add `rideFtpWatts`, `pickSuggested`, `sortRides`, `MIN_EFFORT_SECONDS`)
- Test: `tests/unit/strava.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from Task 1 beyond a tree where `calibrationFactor` no longer exists.
- Produces, all named exports of `routes/strava.js`, used by Task 3 and asserted by Task 10's UI:
  - `MIN_EFFORT_SECONDS: number` — `1200`.
  - `isRide(activity) => boolean`
  - `rideFtpWatts(activity) => number | null` — rounded watts to treat as an FTP, or `null` if the activity carries no usable power.
  - `normalizeRide(activity) => { id, name, date, distanceKm, movingTime, avgSpeedKmh, ftpEstimate, hasPower, commute, longEnough, eligible }`
  - `pickSuggested(normalizedRides) => normalizedRide | null`
  - `sortRides(normalizedRides) => normalizedRide[]` (new array; input untouched)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/strava.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { MIN_EFFORT_SECONDS, rideFtpWatts, normalizeRide, pickSuggested, sortRides } from "../../routes/strava.js";

const act = (over = {}) => ({
  id: 1, name: "Ride", start_date: "2026-07-01T08:00:00Z", distance: 45000,
  moving_time: 3600, average_speed: 8, average_watts: 200,
  weighted_average_watts: 240, device_watts: true, commute: false, type: "Ride",
  ...over,
});

test("MIN_EFFORT_SECONDS is 20 minutes", () => {
  assert.equal(MIN_EFFORT_SECONDS, 1200);
});

test("rideFtpWatts prefers weighted power from a real power meter", () => {
  assert.equal(rideFtpWatts(act()), 240);
});

test("rideFtpWatts falls back to average watts when there is no power meter", () => {
  assert.equal(rideFtpWatts(act({ device_watts: false, average_watts: 187.4 })), 187);
});

test("rideFtpWatts falls back to average watts when a meter ride has no weighted value", () => {
  assert.equal(rideFtpWatts(act({ weighted_average_watts: null, average_watts: 210 })), 210);
});

test("rideFtpWatts returns null when there is no power at all", () => {
  assert.equal(rideFtpWatts(act({ device_watts: false, average_watts: null, weighted_average_watts: null })), null);
});

test("normalizeRide marks a long ride with power as eligible", () => {
  const r = normalizeRide(act());
  assert.equal(r.ftpEstimate, 240);
  assert.equal(r.hasPower, true);
  assert.equal(r.longEnough, true);
  assert.equal(r.eligible, true);
  assert.equal(r.distanceKm, 45);
  assert.equal(r.avgSpeedKmh, 28.8);
});

test("normalizeRide marks a ride under 20 minutes as too short and ineligible", () => {
  const r = normalizeRide(act({ moving_time: 1199 }));
  assert.equal(r.longEnough, false);
  assert.equal(r.eligible, false);
});

test("normalizeRide marks a powerless ride ineligible but keeps it listed", () => {
  const r = normalizeRide(act({ device_watts: false, average_watts: null, weighted_average_watts: null }));
  assert.equal(r.ftpEstimate, null);
  assert.equal(r.eligible, false);
  assert.equal(r.longEnough, true);
});

test("pickSuggested returns the highest-power eligible non-commute ride", () => {
  const rides = [
    normalizeRide(act({ id: 1, weighted_average_watts: 200 })),
    normalizeRide(act({ id: 2, weighted_average_watts: 275 })),
    normalizeRide(act({ id: 3, weighted_average_watts: 250 })),
  ];
  assert.equal(pickSuggested(rides).id, 2);
});

test("pickSuggested ignores commutes and short rides", () => {
  const rides = [
    normalizeRide(act({ id: 1, weighted_average_watts: 300, commute: true })),
    normalizeRide(act({ id: 2, weighted_average_watts: 290, moving_time: 600 })),
    normalizeRide(act({ id: 3, weighted_average_watts: 180 })),
  ];
  assert.equal(pickSuggested(rides).id, 3);
});

test("pickSuggested returns null when nothing qualifies", () => {
  const rides = [normalizeRide(act({ moving_time: 300 }))];
  assert.equal(pickSuggested(rides), null);
});

test("sortRides puts eligible non-commutes first by power, then the rest by date, without mutating the input", () => {
  const rides = [
    normalizeRide(act({ id: 1, moving_time: 300, start_date: "2026-06-01T08:00:00Z" })),
    normalizeRide(act({ id: 2, weighted_average_watts: 210 })),
    normalizeRide(act({ id: 3, moving_time: 300, start_date: "2026-07-10T08:00:00Z" })),
    normalizeRide(act({ id: 4, weighted_average_watts: 260 })),
  ];
  const before = rides.map((r) => r.id);
  assert.deepEqual(sortRides(rides).map((r) => r.id), [4, 2, 3, 1]);
  assert.deepEqual(rides.map((r) => r.id), before);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../../routes/strava.js' does not provide an export named 'MIN_EFFORT_SECONDS'`.

- [ ] **Step 3: Implement the exports in `routes/strava.js`**

Replace the `RIDE_TYPES`/`isRide`/`normalizeRide` block (currently lines 44-58, including the throwaway `impliedCalib = null` from Task 1) with:

```js
// A ride must last at least this long for its power to stand in for an FTP —
// below it a short hard surge reads as a far higher FTP than the rider holds.
export const MIN_EFFORT_SECONDS = 1200;

const RIDE_TYPES = new Set(["Ride", "GravelRide", "VirtualRide", "MountainBikeRide", "EBikeRide"]);
export const isRide = (a) => RIDE_TYPES.has(a.sport_type) || a.type === "Ride";

// Weighted (normalised) power off a real meter is the best FTP stand-in; a bare
// average — including Strava's estimate for riders with no meter — is the fallback.
export function rideFtpWatts(a) {
  const w = a.device_watts ? (a.weighted_average_watts ?? a.average_watts) : a.average_watts;
  return w == null ? null : Math.round(w);
}

export function normalizeRide(a) {
  const ftpEstimate = rideFtpWatts(a);
  const movingTime = a.moving_time || 0;
  const longEnough = movingTime >= MIN_EFFORT_SECONDS;
  return {
    id: a.id, name: a.name, date: a.start_date,
    distanceKm: +((a.distance || 0) / 1000).toFixed(1),
    movingTime,
    avgSpeedKmh: +((a.average_speed || 0) * 3.6).toFixed(1),
    ftpEstimate, hasPower: !!a.device_watts, commute: !!a.commute,
    longEnough, eligible: ftpEstimate != null && longEnough,
  };
}

// The one ride offered up as "your hardest recent effort". The auto-refine uses the
// same function, so the ride the rider is shown is always the ride that gets applied.
export function pickSuggested(rides) {
  return rides.filter((r) => r.eligible && !r.commute)
    .sort((a, b) => b.ftpEstimate - a.ftpEstimate)[0] || null;
}

export function sortRides(rides) {
  const rank = (r) => (r.eligible && !r.commute ? 0 : 1);
  return [...rides].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 0 ? b.ftpEstimate - a.ftpEstimate : new Date(b.date) - new Date(a.date)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 12 new tests in `tests/unit/strava.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add routes/strava.js tests/unit/strava.test.mjs
git commit -m @'
feat: model Strava rides by FTP eligibility, not course distance

Every ride now carries a power-derived FTP estimate and an eligible flag
(power present, 20 minutes or longer). pickSuggested picks the hardest
recent effort and is shared with the auto-refine so the ride a rider is
shown is always the ride that gets applied.
'@
```

---

### Task 3: Rework the refine and rides routes to FTP-only

**Files:**
- Modify: `routes/strava.js` (the `/api/riders/:id/rides` and `/api/riders/:id/refine` handlers)

**Interfaces:**
- Consumes: `MIN_EFFORT_SECONDS`, `isRide`, `normalizeRide`, `pickSuggested`, `sortRides`, `rideFtpWatts` from Task 2.
- Produces the response shapes Task 10's UI reads:
  - `GET /api/riders/:id/rides` → `{ rides: normalizedRide[], suggestedId: number|null, minMinutes: 20 }`. The `course` field is **gone**.
  - `POST /api/riders/:id/refine` with body `{ activityId? }` → `{ matched: true, activity: string, ftp: number, hadPower: boolean, movingTime: number }`, or `{ matched: false, message: string }` when no ride qualifies. The `mode` request field and the `calib`/`effectiveFtp`/`distanceKm` response fields are **gone**.

- [ ] **Step 1: Replace the rides handler**

In `routes/strava.js`, replace the whole `GET /api/riders/:id/rides` handler with:

```js
// list a rider's recent rides, hardest usable effort first
router.get("/api/riders/:id/rides", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    const acts = await recentActivities(access, 50);
    const cutoff = Date.now() - 42 * 864e5;
    const rides = sortRides(acts
      .filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff)
      .map(normalizeRide));
    const suggested = pickSuggested(rides);
    res.json({ rides, suggestedId: suggested?.id ?? null, minMinutes: MIN_EFFORT_SECONDS / 60 });
  } catch (e) { console.error(e); res.status(502).json({ error: "Strava request failed — try again." }); }
}));
```

The auth line stays `requireOrg` for now; Task 6 swaps it for `requireRiderOrOrg` once that helper exists.

- [ ] **Step 2: Replace the refine handler**

Replace the whole `POST /api/riders/:id/refine` handler with:

```js
// Set a rider's FTP from a Strava ride's power. Body: { activityId? } — omit it to
// use the suggested ride (the hardest recent qualifying effort).
router.post("/api/riders/:id/refine", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r?.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
  try {
    const access = await freshAccess(r);
    let act;
    if (req.body?.activityId) {
      act = await activity(access, req.body.activityId);
    } else {
      const acts = await recentActivities(access, 50);
      const cutoff = Date.now() - 42 * 864e5;
      const fresh = acts.filter((a) => isRide(a) && new Date(a.start_date).getTime() >= cutoff);
      const best = pickSuggested(fresh.map(normalizeRide));
      if (!best) return res.json({ matched: false, message: `No ride in the last 6 weeks has power data and lasts ${MIN_EFFORT_SECONDS / 60} minutes or more. Pick a ride yourself, or ask your organiser to type your FTP in.` });
      act = fresh.find((a) => String(a.id) === String(best.id));
    }
    const ftp = rideFtpWatts(act);
    if (ftp == null) return res.status(400).json({ error: "That ride has no power data to read an FTP from." });
    if ((act.moving_time || 0) < MIN_EFFORT_SECONDS) return res.status(400).json({ error: `That ride is under ${MIN_EFFORT_SECONDS / 60} minutes — too short to read an FTP from. Pick a longer, harder effort.` });
    await q("UPDATE riders SET ftp=$1, calib=1, last_refined_at=now() WHERE id=$2", [ftp, r.id]);
    res.json({ matched: true, activity: act.name, ftp, hadPower: !!act.device_watts, movingTime: act.moving_time });
  } catch (e) {
    console.error(e); res.status(502).json({ error: "Strava request failed — try again." });
  }
}));
```

- [ ] **Step 3: Clean up the now-unused imports**

The top of `routes/strava.js` must now read exactly:

```js
import express from "express";
import { q } from "../db.js";
import { eventForRider, requireOrg, baseUrl, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity } from "../lib/strava.mjs";
```

`paramsOf` and `engineRider` are no longer used here — they were only needed to run the physics for the deleted calibration.

- [ ] **Step 4: Verify nothing references the retired concepts on the server**

Run: `git grep -n "impliedCalib\|effectiveFtp\|matchByDistance" -- lib routes tests`
Expected: no matches.

Run: `git grep -n "mode" -- routes/strava.js`
Expected: no matches (the `mode` request field is gone).

`public/` is deliberately **not** in that grep yet — `public/actions.js` still reads
`r.effectiveFtp` and `public/views.js` still reads `rd.impliedCalib`/`rd.matches`. Task 9
removes both and re-runs the grep with `public` included.

**Expected mid-plan breakage:** from this commit until Task 9, the browser's refine flow
throws — `openRidePicker` stores `course: r.course`, which this task stopped returning, and
`ridePickerEl` then reads `course.distanceKm` off `undefined`. The organiser's create /
course / suggest / group-edit / CSV / print flows are all unaffected. Don't "fix" this
between tasks; Task 9 replaces the whole picker.

- [ ] **Step 5: Run the full suite**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/strava.js
git commit -m @'
feat: refine reads FTP from power only, with a 20-minute guard

Drop the course-distance matching and the mode switch. Refine with no
activityId now applies the suggested hardest recent effort, and any ride
under 20 minutes or without power is rejected with a plain-language reason.
'@
```

---

### Task 4: Mint a rider key at sign-up

**Files:**
- Modify: `schema.sql` (add the column)
- Modify: `routes/riders.js:8-18` (the public sign-up handler)
- Test: `tests/integration/riders.test.mjs`

**Interfaces:**
- Consumes: `token()` from `routes/helpers.js` (already exists — `crypto.randomBytes(16).toString("hex")`).
- Produces: `POST /api/events/:code/riders` response gains `riderKey: string`. The column `riders.rider_token TEXT` (nullable). `publicRider` still must not expose it.

- [ ] **Step 1: Write the failing integration tests**

Add to the `describe("riders routes", ...)` block in `tests/integration/riders.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `signup.riderKey` is `undefined`, so the regex assertion throws.

- [ ] **Step 3: Add the column to `schema.sql`**

Add immediately after the `CREATE TABLE IF NOT EXISTS riders (...);` statement and before the `CREATE INDEX` line:

```sql
-- Rider key: lets a rider edit their own row and run their own Strava refinement
-- without the organiser (ADR-0003). Null for rows created before that shipped.
ALTER TABLE riders ADD COLUMN IF NOT EXISTS rider_token TEXT;
```

- [ ] **Step 4: Mint and return it at sign-up**

In `routes/riders.js`, add `token` to the helpers import:

```js
import { getEvent, eventForRider, requireOrg, publicRider, truncate, token, asyncRoute } from "./helpers.js";
```

Then replace the body of the sign-up handler's insert and response:

```js
// public self sign-up — mints the rider's own key, returned exactly once
router.post("/api/events/:code/riders", asyncRoute(async (req, res) => {
  const ev = await getEvent(req.params.code);
  if (!ev) return res.status(404).json({ error: "No event with that code." });
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Name is required." });
  const riderKey = token();
  const { rows } = await q(
    "INSERT INTO riders(event_id,name,weight,ftp,pos,build,rider_token) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [ev.id, truncate(b.name.trim(), 60, ""), Number(b.w) || 75, Number(b.ftp) || 240, b.pos || "road_drops", b.build || "medium", riderKey]
  );
  res.json({ ...publicRider(rows[0]), riderKey });
}));
```

`publicRider` is deliberately left alone — it does not select `rider_token`, which is what keeps the unauthenticated event payload clean.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, including the pre-existing rider tests.

- [ ] **Step 6: Commit**

```bash
git add schema.sql routes/riders.js tests/integration/riders.test.mjs
git commit -m @'
feat: mint a rider key at sign-up (ADR-0003)

Each rider now gets their own token, returned once in the sign-up response
and never included in the public event payload.
'@
```

---

### Task 5: `getRider` + `requireRiderOrOrg`, applied to rider PATCH/DELETE

**Files:**
- Modify: `routes/helpers.js` (add `getRider`, `requireRiderOrOrg`; guard `eventForRider`)
- Modify: `routes/riders.js:20-43` (PATCH and DELETE handlers)
- Test: `tests/unit/helpers.test.mjs`, `tests/integration/riders.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 4 except the `rider_token` column.
- Produces, from `routes/helpers.js`:
  - `getRider(riderId) => Promise<row | null>` — returns `null` for a non-numeric id instead of letting Postgres throw.
  - `requireRiderOrOrg(ev, rider, req, res) => boolean` — true if `x-organiser-token` matches the event or `x-rider-token` matches that rider's `rider_token`. Writes 404/403 itself, same contract as the existing `requireOrg`.

- [ ] **Step 1: Write the failing unit tests**

Add to `tests/unit/helpers.test.mjs`, extending the import on line 3:

```js
import { clampGroupSize, truncate, publicRider, engineRider, paramsOf, requireRiderOrOrg } from "../../routes/helpers.js";
```

```js
const fakeRes = () => ({
  code: null, body: null,
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
});
const fakeReq = (headers) => ({ get: (h) => headers[h.toLowerCase()] ?? undefined });

test("requireRiderOrOrg accepts the event's organiser token", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-organiser-token": "org1" }), res);
  assert.equal(ok, true);
  assert.equal(res.code, null);
});

test("requireRiderOrOrg accepts that rider's own key", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-rider-token": "rid1" }), res);
  assert.equal(ok, true);
});

test("requireRiderOrOrg rejects another rider's key with 403", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: "rid1" }, fakeReq({ "x-rider-token": "rid2" }), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg rejects a rider with no key stored, even if the header is empty too", () => {
  const res = fakeRes();
  const ok = requireRiderOrOrg({ organiser_token: "org1" }, { rider_token: null }, fakeReq({ "x-rider-token": "" }), res);
  assert.equal(ok, false);
  assert.equal(res.code, 403);
});

test("requireRiderOrOrg 404s a missing event or missing rider", () => {
  const noEvent = fakeRes();
  assert.equal(requireRiderOrOrg(null, { rider_token: "r" }, fakeReq({}), noEvent), false);
  assert.equal(noEvent.code, 404);

  const noRider = fakeRes();
  assert.equal(requireRiderOrOrg({ organiser_token: "o" }, null, fakeReq({}), noRider), false);
  assert.equal(noRider.code, 404);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — no export named `requireRiderOrOrg`.

- [ ] **Step 3: Implement the helpers**

In `routes/helpers.js`, replace `eventForRider` with a guarded version and add the two new exports beside it:

```js
const isNumericId = (v) => /^\d+$/.test(String(v));

export async function eventForRider(riderId) {
  if (!isNumericId(riderId)) return null;
  const { rows } = await q("SELECT e.* FROM events e JOIN riders r ON r.event_id=e.id WHERE r.id=$1", [riderId]);
  return rows[0] || null;
}

export async function getRider(riderId) {
  if (!isNumericId(riderId)) return null;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [riderId]);
  return rows[0] || null;
}

// Either the event's organiser or the rider themselves. Same self-reporting
// contract as requireOrg: writes the error response and returns false.
export function requireRiderOrOrg(ev, rider, req, res) {
  if (!ev) { res.status(404).json({ error: "No event with that code." }); return false; }
  if (!rider) { res.status(404).json({ error: "No such rider." }); return false; }
  const org = req.get("x-organiser-token");
  if (org && org === ev.organiser_token) return true;
  const own = req.get("x-rider-token");
  if (own && rider.rider_token && own === rider.rider_token) return true;
  res.status(403).json({ error: "Organiser key, or your own rider key, required." });
  return false;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests for rider self-edit**

Add to `tests/integration/riders.test.mjs`:

```js
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

  test("PATCH /api/riders/:id with a non-numeric id 404s instead of erroring", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/riders/not-an-id`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-rider-token": "whatever" },
      body: JSON.stringify({ name: "x" }),
    });
    assert.equal(res.status, 404);
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — the self-PATCH returns 403 because the route still demands an organiser token.

- [ ] **Step 7: Apply the new check to PATCH and DELETE**

In `routes/riders.js`, update the helpers import:

```js
import { getEvent, eventForRider, getRider, requireRiderOrOrg, publicRider, truncate, token, asyncRoute } from "./helpers.js";
```

`requireOrg` is no longer used in this file — drop it from the import.

Replace the PATCH handler with:

```js
router.patch("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  const b = req.body || {};
  const { rows } = await q(
    "UPDATE riders SET name=$1,weight=$2,ftp=$3,pos=$4,build=$5 WHERE id=$6 RETURNING *",
    [truncate(b.name, 60, r.name), b.w != null ? Number(b.w) : r.weight,
     b.ftp != null ? Number(b.ftp) : r.ftp, b.pos || r.pos, b.build || r.build, r.id]
  );
  res.json(publicRider(rows[0]));
}));
```

The old inline `SELECT * FROM riders WHERE id=$1` plus its `if (!cur[0]) return 404` are replaced by `getRider` + the helper's own 404.

Replace the DELETE handler with:

```js
router.delete("/api/riders/:id", asyncRoute(async (req, res) => {
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
  await q("DELETE FROM riders WHERE id=$1", [r.id]);
  // drop the rider from any stored groups
  const groups = (ev.groups_json || []).map((g) => ({ ...g, members: g.members.filter((m) => String(m) !== String(r.id)) })).filter((g) => g.members.length || g.locked);
  await q("UPDATE events SET groups_json=$1 WHERE id=$2", [JSON.stringify(groups), ev.id]);
  res.json({ ok: true });
}));
```

- [ ] **Step 8: Run the full suite**

Run: `npm run test:all`
Expected: PASS. The pre-existing test `PATCH /api/riders/:id requires an organiser token` still passes — a request with no token at all is still 403.

- [ ] **Step 9: Commit**

```bash
git add routes/helpers.js routes/riders.js tests/unit/helpers.test.mjs tests/integration/riders.test.mjs
git commit -m @'
feat: riders can edit and remove their own row with their rider key

Add getRider and requireRiderOrOrg, and guard both against non-numeric ids
so a junk rider id 404s rather than blowing up in Postgres.
'@
```

---

### Task 6: Rider-or-organiser auth on the Strava routes

**Files:**
- Modify: `routes/strava.js` (`/auth/strava`, `/api/riders/:id/rides`, `/api/riders/:id/refine`)
- Test: `tests/integration/strava.test.mjs` (create)

**Interfaces:**
- Consumes: `getRider`, `requireRiderOrOrg` from Task 5; the route bodies from Task 3.
- Produces: `GET /auth/strava?code=&rider=&key=` — `key` is required and must be the event's organiser key or that rider's rider key. Rides/refine accept `x-rider-token` as well as `x-organiser-token`.

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/strava.test.mjs`. These assert auth only — no test reaches Strava, because every request stops at the auth check or at the "hasn't linked Strava" check before any outbound call is made.

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `/auth/strava` currently redirects to Strava (or 500s on missing config) without checking any key, so the 400/403/404 assertions fail.

- [ ] **Step 3: Rewrite the `/auth/strava` handler**

Replace it with:

```js
// Start the Strava link. A browser link can't send headers, so the caller's key
// rides in the query string: either the event's organiser key or the rider's own.
router.get("/auth/strava", asyncRoute(async (req, res) => {
  const { code, rider, key } = req.query;
  if (!code || !rider || !key) return res.status(400).send("Missing event code, rider or key.");
  const ev = await eventForRider(rider);
  const r = await getRider(rider);
  if (!ev || !r || ev.code !== String(code)) return res.status(404).send("No such rider in that event.");
  const allowed = key === ev.organiser_token || (r.rider_token && key === r.rider_token);
  if (!allowed) return res.status(403).send("That key doesn't grant access to this rider.");
  if (!process.env.STRAVA_CLIENT_ID) return res.status(500).send("Strava is not configured on this server.");
  const state = Buffer.from(JSON.stringify({ code, rider })).toString("base64url");
  res.redirect(authUrl(state, `${baseUrl(req)}/auth/strava/callback`));
}));
```

Note the config guard moved **after** the auth check so an unauthorised caller can't probe whether Strava is set up.

- [ ] **Step 4: Swap the auth check on rides and refine**

In both `/api/riders/:id/rides` and `/api/riders/:id/refine`, replace these three lines:

```js
  const ev = await eventForRider(req.params.id);
  if (!requireOrg(ev, req, res)) return;
  const { rows } = await q("SELECT * FROM riders WHERE id=$1", [req.params.id]);
  const r = rows[0];
```

with:

```js
  const ev = await eventForRider(req.params.id);
  const r = await getRider(req.params.id);
  if (!requireRiderOrOrg(ev, r, req, res)) return;
```

Then fix the follow-on guard in each, which no longer needs the optional chain:

```js
  if (!r.strava_access_token) return res.status(400).json({ error: "This rider hasn't linked Strava yet." });
```

- [ ] **Step 5: Update the imports**

The top of `routes/strava.js` must now read exactly:

```js
import express from "express";
import { q } from "../db.js";
import { eventForRider, getRider, requireRiderOrOrg, baseUrl, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity } from "../lib/strava.mjs";
```

- [ ] **Step 6: Run the full suite**

Run: `npm run test:all`
Expected: PASS, including all eight new Strava auth tests.

- [ ] **Step 7: Commit**

```bash
git add routes/strava.js tests/integration/strava.test.mjs
git commit -m @'
fix: require a key to link or refine Strava for a rider

GET /auth/strava previously had no auth check at all — an event code and a
guessable integer rider id were enough to start an OAuth link for anyone.
It now demands the organiser key or that rider's own key, as do the rides
and refine routes.
'@
```

---

### Task 7: Frontend plumbing for the rider key

**Files:**
- Modify: `public/state.js`
- Modify: `public/api.js:4-11`

**Interfaces:**
- Consumes: the `riderKey` field from Task 4's sign-up response; the `x-rider-token` header from Tasks 5–6.
- Produces, for Tasks 8–10:
  - `riderKeyLS(code, id) => string` — the localStorage key, exported from `public/state.js`.
  - `state.riderId: number | null`, `state.riderKey: string`, `state.mode === "rider"`, `state.justSignedUp: { name, id, code, key } | null`.
  - `api(path, method, body, auth)` where `auth` is `"rider"` (sends `x-rider-token`), any other truthy value (sends `x-organiser-token`, unchanged from today), or falsy (no auth).

- [ ] **Step 1: Rewrite the head of `public/state.js`**

Replace lines 1-21 (everything from the `POSITIONS` export down to and including the `if (state.code) state.token = ...` line) with:

```js
export const POSITIONS = { road_hoods: "Road · hoods", road_drops: "Road · drops", aero_drops: "Aero road · drops", clipon: "Clip-on aero bars", tt: "TT / Tri bike" };
export const BUILDS = { small: "Small", medium: "Medium", tall: "Tall" };
export const SHADES = ["#ff2f74", "#c8134f", "#ff6f9e", "#8f0d3a", "#ff9dbe", "#e84d86", "#5c0a26", "#ffc2d6"];
export const app = document.getElementById("app");
export const params = new URLSearchParams(location.search);
export const LS = window.localStorage;

export const riderKeyLS = (code, id) => `pursuit:riderkey:${code}:${id}`;

const startCode = params.get("code") || LS.getItem("pursuit:lastCode") || "";
const qRider = params.get("rider"), qKey = params.get("key");
const riderId = qRider && /^\d+$/.test(qRider) ? Number(qRider) : null;

// A rider arriving on their own link carries their key in the URL; remember it so
// the same device recognises them next time without the link.
let riderKey = "";
if (startCode && riderId) {
  riderKey = qKey || LS.getItem(riderKeyLS(startCode, riderId)) || "";
  if (qKey) LS.setItem(riderKeyLS(startCode, riderId), qKey);
}

export const state = {
  code: startCode,
  token: "",
  riderId,
  riderKey,
  signup: params.get("signup") === "1",
  data: null,
  work: { groups: [], unassigned: [] },
  sel: null,
  saveStatus: "",
  ridePicker: null,
  mode: riderId && riderKey ? "rider" : (startCode ? "app" : "landing"),
  justCreated: null,
  justSignedUp: null,
  banner: params.get("stravalinked") ? "Strava linked — you can refine your FTP now." : params.get("stravaerror") ? "Strava linking failed." : "",
};
if (state.code) state.token = LS.getItem("pursuit:token:" + state.code) || "";
```

- [ ] **Step 2: Teach `api()` to send a rider token**

In `public/api.js`, replace the `api` function with:

```js
export async function api(path, method = "GET", body, auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth === "rider") headers["x-rider-token"] = state.riderKey;
  else if (auth) headers["x-organiser-token"] = state.token;
  const res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}
```

Every existing caller passes `true`, which still means organiser — no call site changes.

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check public/state.js; if ($?) { node --check public/api.js }`
Expected: no output, exit 0.

- [ ] **Step 4: Verify the app still boots for an organiser**

Start the server (`npm start` with `DATABASE_URL` set), open the app, create an event, add a rider by hand, and confirm the organiser flow is unchanged. The repo has no DOM test harness — `public/format.js` and `public/course.js` are unit tested because they are pure, while `views.js`/`state.js`/`api.js` are verified by running the app. Follow that convention for the remaining frontend tasks.

- [ ] **Step 5: Commit**

```bash
git add public/state.js public/api.js
git commit -m @'
feat: carry a rider key in frontend state and api()

state picks up rider/key query params, remembers the key per event+rider in
localStorage, and flips to mode "rider". api() can send x-rider-token.
'@
```

---

### Task 8: Sign-up confirmation shows the rider their key

**Files:**
- Modify: `public/actions.js` (add `riderMailto`, `copyRiderDetails`, `signUp`, `openRiderPage`)
- Modify: `public/views.js:303-323` (`renderSignup`) and add `renderSignedUp`

**Interfaces:**
- Consumes: `riderKeyLS`, `state.justSignedUp` from Task 7; `riderKey` in the sign-up response from Task 4.
- Produces, from `public/actions.js`:
  - `riderLink(code, id, key) => string`
  - `riderMailto(name, code, id, key) => string`
  - `copyRiderDetails(name, code, id, key) => void`
  - `signUp(code, body) => Promise<void>` — posts the sign-up, stores the key, sets `state.justSignedUp`, re-renders.
  - `openRiderPage() => void` — leaves sign-up mode and loads the rider's own page.

- [ ] **Step 1: Add the rider-link actions**

Append to `public/actions.js`:

```js
export const riderLink = (code, id, key) =>
  `${origin()}/?code=${encodeURIComponent(code)}&rider=${id}&key=${encodeURIComponent(key)}`;

export function riderMailto(name, code, id, key) {
  const body = `Your rider link for this Pursuit event — open it any time to change your weight, FTP or bike, link Strava, or update your FTP from a ride.\n\n`
    + `Rider: ${name}\nEvent code: ${code}\nYour rider key: ${key}\n\n`
    + `Your rider page: ${riderLink(code, id, key)}\n\n`
    + `Keep this link. It's the only way back in from another device.\n`;
  return `mailto:?subject=${encodeURIComponent(`My Pursuit rider link (${code})`)}&body=${encodeURIComponent(body)}`;
}

export function copyRiderDetails(name, code, id, key) {
  const text = `Pursuit rider: ${name}\nEvent: ${code}\nRider key: ${key}\nMy rider page: ${riderLink(code, id, key)}`;
  navigator.clipboard?.writeText(text);
  state.banner = "Your rider link is copied — paste it somewhere safe.";
  render();
}

export async function signUp(code, body) {
  const r = await api("/events/" + encodeURIComponent(code) + "/riders", "POST", body);
  state.code = code;
  state.riderId = r.id;
  state.riderKey = r.riderKey;
  LS.setItem(riderKeyLS(code, r.id), r.riderKey);
  LS.setItem("pursuit:lastCode", code);
  state.justSignedUp = { name: r.name, id: r.id, code, key: r.riderKey };
  render();
}

export function openRiderPage() {
  state.signup = false;
  state.justSignedUp = null;
  state.mode = "rider";
  state.banner = "";
  loadEvent();
}
```

Update the imports at the top of `public/actions.js` to:

```js
import { state, LS, riderKeyLS } from "./state.js";
import { api, loadEvent, syncWork } from "./api.js";
import { render } from "./views.js";
```

- [ ] **Step 2: Rewrite `renderSignup` and add `renderSignedUp`**

In `public/views.js`, replace the whole `/* ---- rider self sign-up ---- */` section (from `function renderSignup() {` to the end of the file) with:

```js
/* ---- rider self sign-up -------------------------------------------------- */
function renderSignup() {
  if (state.justSignedUp) return renderSignedUp();
  app.innerHTML = `<div class="center">
    <a class="ghost" href="/?code=${encodeURIComponent(state.code)}" style="align-self:flex-start">‹ Organiser view</a>
    <span class="kicker">Rider sign-up</span><h1 class="su-title">ADD YOUR DETAILS</h1>
    <label class="f">Event code<input id="code" value="${esc(state.code)}"/></label>
    <label class="f">Name<input id="name" placeholder="Your name"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="w" value="75"/></label><label class="f">FTP (W)<input type="number" id="ftp" value="240"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === "road_drops" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === "medium" ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <p class="micro">Not sure of your FTP? Your best hour-power guess is fine — you can fix it later, or read it off a Strava ride.</p>
    <button class="btn block" id="send">Send to organiser</button><p class="hint" id="status"></p></div>`;
  document.getElementById("send").onclick = async () => {
    const code = document.getElementById("code").value.trim().toLowerCase();
    const body = { name: document.getElementById("name").value, w: +document.getElementById("w").value, ftp: +document.getElementById("ftp").value, pos: document.getElementById("pos").value, build: document.getElementById("build").value };
    const status = document.getElementById("status");
    if (!body.name.trim()) { status.textContent = "Add your name first."; return; }
    status.textContent = "Sending…";
    try { await signUp(code, body); }
    catch (e) { status.textContent = e.message; }
  };
}

function renderSignedUp() {
  const { name, id, code, key } = state.justSignedUp;
  app.innerHTML = `<div class="landing"><div class="rule"></div>
    <div class="land-head"><span class="kicker" style="color:#1f7a4d">You're in</span><h1>${esc(name)}</h1></div>
    <div class="rule"></div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="created">
      <p class="hint">This link is yours. Open it any time to change your details, link Strava, or set your FTP from a ride — no need to bother the organiser.</p>
      <div class="cr-field"><span>Your rider page</span><input readonly value="${riderLink(code, id, key)}"/></div>
      <div class="row" style="margin:6px 0 4px"><a class="btn" id="email">✉ Email me my link</a><button class="add" id="copy">Copy my link</button></div>
      <p class="micro">This device will remember you automatically. Save the link if you might use a different phone or computer — there's no way to look it up later.</p>
      <button class="btn block" id="go" style="margin-top:12px">Open my rider page ›</button>
    </div>
    <p class="land-foot">Your organiser can see you in the rider list now.</p>
  </div>`;
  document.getElementById("email").href = riderMailto(name, code, id, key);
  document.getElementById("copy").onclick = () => copyRiderDetails(name, code, id, key);
  document.getElementById("go").onclick = openRiderPage;
}
```

- [ ] **Step 3: Update the `views.js` action imports**

Change line 4 of `public/views.js` to:

```js
import { toLanding, detailsMailto, copyDetails, createEvent, openExisting, patchEvent, addRider, updRider, delRider, openRidePicker, autoRefine, applyRefine, origin, signUp, riderLink, riderMailto, copyRiderDetails, openRiderPage } from "./actions.js";
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check public/actions.js; if ($?) { node --check public/views.js }`
Expected: no output, exit 0.

- [ ] **Step 5: Verify the flow by hand**

With the server running: open `/?code=<event>&signup=1`, submit a rider, and confirm the confirmation screen appears with a working rider link, that "Copy my link" puts it on the clipboard, and that "Open my rider page" navigates without error (the page itself lands in Task 9 — until then it falls through to the organiser view, which is expected mid-plan).

- [ ] **Step 6: Commit**

```bash
git add public/actions.js public/views.js
git commit -m @'
feat: show a rider their own link and key after sign-up

Mirrors the organiser's event-created screen: copy/email the link, and the
signing-up device remembers the key so returning riders need no link at all.
'@
```

---

### Task 9: Rider self-service page

**Files:**
- Modify: `public/views.js` (`render` dispatch + new `renderRiderPage`)
- Modify: `public/actions.js` (add `updRiderSelf`; thread `auth` through the refine actions)
- Modify: `public/api.js:24` (`loadEvent` must stop stomping rider mode — see Step 2b)

**Interfaces:**
- Consumes: `state.mode === "rider"`, `state.riderId`, `state.riderKey`, `riderLink` from Tasks 7–8; the `"rider"` auth mode in `api()` from Task 7; the `{ rides, suggestedId, minMinutes }` response shape from Task 3.
- Produces, all in `public/actions.js` unless noted:
  - `updRiderSelf(id, body) => Promise<void>`
  - `openRidePicker(id, auth = true) => Promise<void>` — stores `state.ridePicker = { riderId, rides, suggestedId, minMinutes, auth }`
  - `applyRefine(id, activityId, auth = true) => Promise<void>`
  - `autoRefine(id, auth = true) => Promise<void>`
  - `bannerFromRefine(r) => string`
  - `renderRiderPage()` in `public/views.js`, reached whenever `state.mode === "rider"` and `state.data` is loaded.

The refine actions are updated here, not in Task 10, for two reasons: the rider page is the
first caller that needs a non-organiser auth mode, and `bannerFromRefine` currently reads
`r.mode` and `r.effectiveFtp`, which Task 3 already stopped returning. Task 10 changes only
the picker's markup and consumes these signatures unchanged.

- [ ] **Step 1: Add the rider's own save action and thread auth through the refine actions**

Append to `public/actions.js`:

```js
export const updRiderSelf = (id, body) =>
  api("/riders/" + id, "PATCH", body, "rider").then(loadEvent).catch((e) => alert(e.message));
```

Then replace the existing `openRidePicker`, `bannerFromRefine`, `applyRefine` and
`autoRefine` with these. `auth` defaults to `true` (organiser), so the organiser's existing
call sites in `riderRow` keep working untouched:

```js
export async function openRidePicker(id, auth = true) {
  state.banner = "Looking through your recent rides…"; render();
  try {
    const r = await api("/riders/" + id + "/rides", "GET", null, auth);
    state.ridePicker = { riderId: id, rides: r.rides, suggestedId: r.suggestedId, minMinutes: r.minMinutes, auth };
    state.banner = ""; render();
  } catch (e) { state.banner = e.message; render(); }
}

export function bannerFromRefine(r) {
  if (!r.matched) return r.message;
  const src = r.hadPower ? "power meter" : "Strava's power estimate";
  return `FTP set to ${r.ftp} W from “${r.activity}” (${src}).`;
}

export async function applyRefine(id, activityId, auth = true) {
  state.ridePicker = null; state.banner = "Reading that ride…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", { activityId }, auth); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}

export async function autoRefine(id, auth = true) {
  state.ridePicker = null; state.banner = "Finding your hardest recent effort…"; render();
  try { const r = await api("/riders/" + id + "/refine", "POST", {}, auth); state.banner = bannerFromRefine(r); await loadEvent(); }
  catch (e) { state.banner = e.message; render(); }
}
```

- [ ] **Step 1b: Confirm the stale response fields are gone from the frontend**

Run: `git grep -n "effectiveFtp\|impliedCalib\|\.matches" -- public`
Expected: matches only in `public/views.js` (`rd.impliedCalib` and `rd.matches` inside
`ridePickerEl`, which Task 10 replaces). Zero matches in `public/actions.js`.

- [ ] **Step 2: Route `mode === "rider"` in `render()`**

In `public/views.js`, replace the first two lines of `render()`:

```js
export function render() {
  if (state.signup) return renderSignup();
  if (state.mode === "landing" || !state.data) return renderLanding();
```

with:

```js
export function render() {
  if (state.signup) return renderSignup();
  if (state.mode === "rider" && state.data) return renderRiderPage();
  if (state.mode === "landing" || !state.data) return renderLanding();
```

- [ ] **Step 2b: Stop `loadEvent` from stomping rider mode**

This step was missing from the plan's first draft and without it the rest of this task is
dead on arrival — `renderRiderPage` would be correct but unreachable.

`public/app.js` itself needs no change: a rider link carries `code`, so the existing bootstrap
calls `loadEvent()`. But `loadEvent` currently ends its success path with an unconditional
`state.mode = "app"`, which overwrites the `"rider"` that `state.js` just computed. The rider
page would never render.

In `public/api.js`, in `loadEvent`'s `try` block, replace:

```js
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); syncWork(); state.mode = "app"; }
```

with:

```js
  // A rider arriving on their own link is already in "rider" mode; don't demote them to the
  // organiser view just because the event loaded.
  try { state.data = await api("/events/" + encodeURIComponent(state.code)); LS.setItem("pursuit:lastCode", state.code); syncWork(); state.mode = state.riderId && state.riderKey ? "rider" : "app"; }
```

The `catch` branch stays as it is — a rider whose event code is wrong should land on the
landing screen with the existing error banner, same as anyone else.

This also makes `openRiderPage()` (Task 8) work: it sets `state.mode = "rider"` and then calls
`loadEvent()`, which now recomputes the same value instead of undoing it.

- [ ] **Step 3: Add `updRiderSelf` to the `views.js` action imports**

`renderRiderPage` calls it, so extend line 4 of `public/views.js` (which Task 8 already
lengthened) to end with `updRiderSelf`:

```js
import { toLanding, detailsMailto, copyDetails, createEvent, openExisting, patchEvent, addRider, updRider, delRider, openRidePicker, autoRefine, applyRefine, origin, signUp, riderLink, riderMailto, copyRiderDetails, openRiderPage, updRiderSelf } from "./actions.js";
```

Everything else `renderRiderPage` uses — `el`, `esc`, `fmtDur`, `addClock`, `POSITIONS`,
`BUILDS`, `ridersById`, `openRidePicker`, `riderLink` — is already imported by this file.

- [ ] **Step 4: Add `renderRiderPage`**

Add to `public/views.js`, immediately above the `/* ---- rider self sign-up ---- */` section:

```js
/* ---- rider self-service -------------------------------------------------- */
function renderRiderPage() {
  const me = (state.data.riders || []).find((r) => r.id === state.riderId);
  if (!me) {
    app.innerHTML = `<div class="center"><span class="kicker">Rider</span><h1 class="su-title">NOT FOUND</h1>
      <p class="hint">You're not on the rider list for “${esc(state.code)}” any more — the organiser may have removed you. Sign up again with the link they sent you.</p>
      <a class="btn" href="/?code=${encodeURIComponent(state.code)}&signup=1">Sign up again</a></div>`;
    return;
  }
  const ev = state.data.event;
  const km = ev?.course ? (ev.course.distanceM / 1000).toFixed(1) : "—";
  const mine = state.data.sheet?.rows?.find((row) => row.members.some((m) => m.id === me.id));
  const wkg = (me.ftp / (me.w + 8)).toFixed(2);

  app.innerHTML = `
    <div class="mast"><div class="rule"></div>
      <div class="mast-row">
        <div><span class="kicker">Your details</span><h1>THE PURSUIT</h1></div>
        <div class="meta"><div><span>Event</span><b>${esc(ev.name)}</b></div><div><span>Distance</span><b>${km} km</b></div><div><span>W/kg</span><b>${wkg}</b></div></div>
      </div><div class="rule"></div>
    </div>
    ${state.banner ? `<div class="banner">${esc(state.banner)}</div>` : ""}
    <div class="grid"><div class="col" id="left"></div><div class="col" id="right"></div></div>
    <div class="foot">Theoretical times — a planning aid, not a promise.</div>`;
  const left = document.getElementById("left"), right = document.getElementById("right");

  const card = el(`<div class="panel"><div class="panel-hd"><h2>${esc(me.name)}</h2></div>
    <p class="hint">Change anything here and it updates the start sheet straight away. Only you and your organiser can edit this.</p>
    <label class="f">Name<input id="r-name" value="${esc(me.name)}"/></label>
    <div class="two"><label class="f">Weight (kg)<input type="number" id="r-w" value="${me.w}"/></label>
      <label class="f">FTP (W)<input type="number" id="r-ftp" value="${me.ftp}"/></label></div>
    <div class="two"><label class="f">Bike / position<select id="r-pos">${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${k === me.pos ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Build<select id="r-build">${Object.entries(BUILDS).map(([k, v]) => `<option value="${k}" ${k === me.build ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <p class="micro">Weight is you plus kit; the model adds 8 kg for the bike.</p>
  </div>`);
  const save = () => updRiderSelf(me.id, {
    name: card.querySelector("#r-name").value,
    w: +card.querySelector("#r-w").value,
    ftp: +card.querySelector("#r-ftp").value,
    pos: card.querySelector("#r-pos").value,
    build: card.querySelector("#r-build").value,
  });
  card.querySelector("#r-name").onblur = save;
  card.querySelectorAll("#r-w,#r-ftp,#r-pos,#r-build").forEach((i) => (i.onchange = save));
  left.appendChild(card);

  const sv = el(`<div class="panel"><div class="panel-hd"><h2>FTP from Strava</h2></div>
    <p class="hint">${me.strava
      ? "Linked. Pick a recent hard ride and we'll read your FTP off its power data — no typing, no guessing."
      : "Link Strava once, then your FTP can come straight off a recent hard ride instead of a guess."}</p>
    <div class="row">
      <a class="add" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${me.id}&key=${encodeURIComponent(state.riderKey)}">${me.strava ? "Re-link Strava" : "Link Strava"}</a>
      ${me.strava ? `<button class="btn" id="r-refine">Update my FTP from a ride</button>` : ""}
    </div>
    ${me.lastRefined ? `<p class="micro">Last updated from Strava on ${esc(new Date(me.lastRefined).toLocaleDateString())}.</p>` : ""}
  </div>`);
  const rb = sv.querySelector("#r-refine"); if (rb) rb.onclick = () => openRidePicker(me.id, "rider");
  left.appendChild(sv);

  const start = el(`<div class="panel"><div class="panel-hd"><h2>Your start</h2></div>
    ${mine
      ? `<div class="cr-field"><span>Your group</span><code>${mine.members.map((m) => esc(m.name)).join(" · ")}</code></div>
         <div class="cr-field"><span>Rolls off at</span><code>${addClock(ev.firstStart, mine.offset)}</code></div>
         <div class="cr-field"><span>Predicted time</span><code>${fmtDur(mine.dur)}</code></div>
         <p class="micro">Seed ${mine.seed} of ${state.data.sheet.rows.length} · your share of the front is about ${Math.round((mine.members.find((m) => m.id === me.id)?.front || 0) * 100)}%.</p>`
      : `<p class="empty">Your organiser hasn't put you in a group yet. Check back once they've set the groups.</p>`}
    <p class="hint" style="margin-top:10px">Keep your rider link safe — it's how you get back in from another device.</p>
    <div class="cr-field"><span>Your rider page</span><input readonly value="${riderLink(state.code, me.id, state.riderKey)}"/></div>
  </div>`);
  right.appendChild(start);

  if (state.ridePicker) app.appendChild(ridePickerEl());
}
```

- [ ] **Step 5: Verify no syntax errors**

Run: `node --check public/actions.js; if ($?) { node --check public/views.js }`
Expected: no output, exit 0.

- [ ] **Step 6: Verify by hand**

With the server running: sign a rider up, click "Open my rider page", then confirm you can change FTP/weight/position and see the value persist across a reload; confirm the "Your start" panel shows the group and roll-off time once the organiser has run Suggest; confirm the page still works after closing the tab and revisiting `/?code=<event>&rider=<id>` **without** `key=` (localStorage supplies it); and confirm opening that same URL in a private window with no `key=` falls through to the organiser/landing view rather than showing someone else's editable details.

Refining from the rider page needs Task 10's picker markup to read well, but the wiring is
already correct here — clicking "Update my FTP from a ride" must open the picker and send
the rider's key (no 403), even though the layout is still the old one.

- [ ] **Step 7: Commit**

```bash
git add public/actions.js public/views.js
git commit -m @'
feat: rider self-service page

Riders can edit their own details, link Strava, refine their own FTP, and see
their group and roll-off time — none of which needed to go through the
organiser. Directly cuts the organiser's per-rider workload.
'@
```

---

### Task 10: Rework the ride picker for non-technical riders

**Files:**
- Modify: `public/views.js` (`ridePickerEl`, plus the organiser's `riderRow`)
- Modify: `public/styles.css` (two rules)

**Interfaces:**
- Consumes: `state.ridePicker = { riderId, rides, suggestedId, minMinutes, auth }` and the
  `openRidePicker(id, auth)` / `applyRefine(id, activityId, auth)` / `autoRefine(id, auth)`
  signatures — all established in Task 9. The normalized ride fields
  (`ftpEstimate`, `hasPower`, `commute`, `longEnough`, `eligible`, `movingTime`,
  `distanceKm`, `date`, `name`, `id`) come from Task 2.
- Produces: no new exports. This task is markup and copy only — the data flow is already
  in place, so nothing downstream depends on it.

- [ ] **Step 1: Rewrite `ridePickerEl`**

In `public/views.js`, replace the whole `ridePickerEl` function with:

```js
function ridePickerEl() {
  const { riderId, rides, suggestedId, minMinutes, auth } = state.ridePicker;
  const rider = ridersById()[riderId];
  const suggested = rides.find((r) => r.id === suggestedId) || null;
  const others = rides.filter((r) => r.id !== suggestedId);
  const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const powerLabel = (rd) => rd.ftpEstimate == null ? "no power data"
    : `${rd.ftpEstimate} W · ${rd.hasPower ? "power meter" : "Strava estimate"}`;
  const why = (rd) => rd.eligible ? "" : rd.ftpEstimate == null ? "no power data"
    : `under ${minMinutes} min`;

  const overlay = el(`<div class="modal-back"><div class="modal">
    <div class="modal-hd"><div><span class="kicker">Set FTP from a ride</span><h2>${esc(rider?.name || "Rider")}</h2></div><button class="modal-x" id="close">×</button></div>
    <div id="suggestion"></div>
    <div class="modal-tools"><span class="hint">Or pick a different ride — it needs power data and at least ${minMinutes} minutes.</span></div>
    <div class="ridelist" id="ridelist"></div>
  </div></div>`);
  overlay.querySelector("#close").onclick = () => { state.ridePicker = null; render(); };
  overlay.onclick = (e) => { if (e.target === overlay) { state.ridePicker = null; render(); } };

  const sug = overlay.querySelector("#suggestion");
  if (suggested) {
    const box = el(`<div class="ridecard match">
      <div class="ride-main"><span class="kicker">Your hardest recent effort</span>
        <b>${esc(suggested.name)}</b>
        <span class="ride-sub">${shortDate(suggested.date)} · ${suggested.distanceKm} km · ${fmtDur(suggested.movingTime)} · ${powerLabel(suggested)}</span></div>
      <p class="hint">This sets your FTP to <b>${suggested.ftpEstimate} W</b>.</p>
      <div class="ride-acts"><button class="btn" id="usesug">Use this ride</button></div></div>`);
    box.querySelector("#usesug").onclick = () => autoRefine(riderId, auth);
    sug.appendChild(box);
  } else {
    sug.appendChild(el(`<p class="empty">No ride in the last 6 weeks has power data and lasts ${minMinutes} minutes or more. Pick one below if you think it's a fair effort, or type your FTP in by hand instead.</p>`));
  }

  const list = overlay.querySelector("#ridelist");
  if (!others.length) list.innerHTML = `<p class="empty">No other rides in the last 6 weeks.</p>`;
  others.forEach((rd) => {
    const reason = why(rd);
    const card = el(`<div class="ridecard ${rd.eligible ? "" : "dim"}">
      <div class="ride-main"><b>${esc(rd.name)}</b>
        <span class="ride-sub">${shortDate(rd.date)} · ${rd.distanceKm} km · ${fmtDur(rd.movingTime)} · ${powerLabel(rd)}</span></div>
      <div class="ride-tags">${rd.commute ? `<span class="tg tg-com">commute</span>` : ""}${rd.hasPower ? `<span class="tg tg-pow">power meter</span>` : ""}${reason ? `<span class="tg">${esc(reason)}</span>` : ""}</div>
      <div class="ride-acts"><button class="add use" ${rd.eligible ? "" : "disabled"} title="${rd.eligible ? `Set FTP to ${rd.ftpEstimate} W` : `Can't use this ride — ${reason}`}">${rd.eligible ? `Use · ${rd.ftpEstimate} W` : "Can't use"}</button></div></div>`);
    const btn = card.querySelector(".use");
    if (rd.eligible) btn.onclick = () => applyRefine(riderId, rd.id, auth);
    list.appendChild(card);
  });
  return overlay;
}
```

- [ ] **Step 2: Add the `dim` and bare-`tg` styles**

Append to `public/styles.css`:

```css
.ridecard.dim { opacity: .55; }
.ride-tags .tg { background: #eee; color: #555; }
```

If `.tg` already carries a background in `styles.css`, keep whichever rule is more specific — the point is that an ineligibility reason reads as muted, not as a positive tag.

- [ ] **Step 3: Update the organiser's Strava link and Refine copy**

In `riderRow` in `public/views.js`, the Strava link must now carry the organiser key as `key=`. Replace:

```js
      ${canEdit ? `<a class="ghost" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${r.id}">${r.strava ? "Re-link" : "Link Strava"}</a>` : ""}
      ${canEdit && r.strava ? `<button class="ghost refine">Refine</button>` : ""}</div></div>`);
```

with:

```js
      ${canEdit ? `<a class="ghost" href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${r.id}&key=${encodeURIComponent(state.token)}">${r.strava ? "Re-link" : "Link Strava"}</a>` : ""}
      ${canEdit && r.strava ? `<button class="ghost refine" title="Set this rider's FTP from one of their Strava rides">Set FTP from Strava</button>` : ""}</div></div>`);
```

and update the handler lookup on the next block from `.refine` — the class is unchanged, so `row.querySelector(".refine")` still works.

Also drop the now-meaningless calibration readout in the same function. Replace:

```js
      <span class="micro">${wkg} W/kg${r.calib && r.calib !== 1 ? ` · cal ×${r.calib.toFixed(2)}` : ""}</span>
```

with:

```js
      <span class="micro">${wkg} W/kg${r.lastRefined ? ` · FTP from Strava ${esc(new Date(r.lastRefined).toLocaleDateString())}` : ""}</span>
```

- [ ] **Step 4: Verify no syntax errors and that no stale field reads remain**

Run: `node --check public/views.js`
Expected: no output, exit 0.

Run: `git grep -n "effectiveFtp\|impliedCalib\|\.matches" -- public`
Expected: no matches anywhere in `public/`. This is the check Task 3 deferred — the frontend
no longer reads a single field the server stopped sending.

Do **not** also grep for `calib` here: it legitimately survives in `public/state.js`'s
`ridersById` and in `computeSheet`'s output, because ADR-0001 keeps the field in the engine
formula and in stored rows. Only the *display* of a calibration multiplier is gone (Step 3).

- [ ] **Step 5: Verify by hand against a real Strava account**

This is the one flow the automated suite cannot cover — it needs live Strava config (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `BASE_URL`) and a real linked account. Check:
1. As a rider, link Strava, then "Update my FTP from a ride" — the suggested card names one real ride and states the watts it will set.
2. "Use this ride" applies it and the banner reads `FTP set to N W from "<ride>" (power meter)`.
3. A short ride in the list is disabled and tagged `under 20 min`; a ride with no power is disabled and tagged `no power data`.
4. As the organiser, "Set FTP from Strava" on that same rider still works (organiser key path).
5. With no qualifying ride at all, the empty-state copy appears instead of a broken suggestion.

- [ ] **Step 6: Commit**

```bash
git add public/views.js public/styles.css
git commit -m @'
feat: ride picker leads with one suggested effort

Show the hardest recent qualifying ride and the exact FTP it will set, with
the rest of the list behind it and plain-language reasons ("under 20 min",
"no power data") on the ones that can't be used.
'@
```

---

### Task 11: Update the docs to match

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md` (one term correction)

**Interfaces:**
- Consumes: the final API surface from Tasks 3–6.
- Produces: no code.

- [ ] **Step 1: Update the README's API block**

Replace the `## API` fenced block with:

```
POST   /api/events                     {name, code?}      -> event + organiserToken
GET    /api/events/:code                                  -> event, riders, groups, sheet
PATCH  /api/events/:code               (org)  {name?, groupSize?, firstStart?, courseManual?, course?, params?}
POST   /api/events/:code/riders                {name,w,ftp,pos,build}  public sign-up -> rider + riderKey
PATCH  /api/riders/:id                 (org | self)
DELETE /api/riders/:id                 (org | self)
POST   /api/events/:code/suggest       (org)  {size?}     compute + store groups
PUT    /api/events/:code/groups        (org)  {groups}    save a manual arrangement
GET    /auth/strava?code=&rider=&key=                     start OAuth (key = organiser or rider key)
GET    /auth/strava/callback                              store tokens
GET    /api/riders/:id/rides           (org | self)       recent rides, hardest usable effort first
POST   /api/riders/:id/refine          (org | self)  {activityId?}   set FTP from a ride's power
```

Then replace the line below it:

```
Organiser routes require the `x-organiser-token` header.
```

with:

```
Organiser routes require the `x-organiser-token` header. Rider routes accept either
that or the rider's own `x-rider-token`. `/auth/strava` is a browser navigation and
so takes the key as a `key=` query param instead of a header.
```

- [ ] **Step 2: Update the README's "Using it" section**

Replace the `- **Strava**: ...` bullet with:

```
- **Riders manage themselves**: each rider gets their own link and key at sign-up
  (shown once, remembered on that device). From it they can fix their weight, FTP,
  bike and build, link Strava, set their FTP from a ride, and see their group and
  roll-off time — none of it routed through the organiser.
- **Strava**: linking is per rider. "Set FTP from Strava" offers the rider's hardest
  recent qualifying effort — power data present, at least 20 minutes long — and states
  the exact FTP it will set. Rides that are too short or have no power are listed but
  can't be used. There is no time-based calibration; see `docs/adr/0001-…`.
```

Also replace this bullet:

```
- **Set the course** (distance + ascent) and a **group size**, then **Suggest**.
```

with:

```
- **Set the course** (drop a GPX/FIT, or type distance + ascent) and a **group size**,
  then **Suggest**. The physics assumptions are fixed and not tunable per event
  (see `docs/adr/0002-…`).
```

- [ ] **Step 3: Update the README's status section**

Replace the "Honest status" paragraph about what is tested with:

```
The **engine, grouping, start-sheet seeding, group-edit operations, the Strava ride
model (FTP eligibility and suggestion picking), and the browser GPX/FIT parser are
unit tested**, and **events, riders, groups and the Strava auth checks have integration
tests** against a real Postgres (`embedded-postgres`, no Docker). What automated tests
can't cover is the live Strava round-trip itself — OAuth against a real account and
reading power off real activities — so verify that by hand with `STRAVA_CLIENT_ID`,
`STRAVA_CLIENT_SECRET` and `BASE_URL` set.
```

- [ ] **Step 4: Correct the `Refine` term in `CONTEXT.md`**

The glossary entry for **Refine** says "subject to a minimum-duration guard" without naming it. Replace that entry's first sentence with:

```
The action of updating a rider's FTP directly from their linked Strava ride's power
data — a real, sustained effort of at least 20 minutes (`MIN_EFFORT_SECONDS`).
```

- [ ] **Step 5: Check every README claim against the tree**

Run: `git grep -n "matchByDistance\|Use time\|impliedCalib\|calibrationFactor" -- README.md CONTEXT.md`
Expected: no matches outside a deliberate historical reference in `CONTEXT.md`'s `_Avoid_` line for **Refine**, which is correct and should stay.

- [ ] **Step 6: Run the full suite one last time**

Run: `npm run test:all`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add README.md CONTEXT.md
git commit -m @'
docs: bring README and glossary in line with the new auth and refine flow
'@
```

---

## Verification checklist for the whole plan

Run before calling this done:

- [ ] `npm run test:all` passes.
- [ ] `git grep -n "calibrationFactor\|impliedCalib\|effectiveFtp"` finds matches only in `docs/`.
- [ ] `GET /api/events/:code` on an event with riders returns no `riderKey` or `rider_token` in any rider object.
- [ ] `GET /auth/strava` with no `key`, a wrong `key`, and another rider's `key` returns 400/403/403 respectively.
- [ ] A rider can complete the whole loop with no organiser action beyond sharing the sign-up link: sign up → save link → edit FTP → link Strava → set FTP from a ride → see their roll-off time.
- [ ] The organiser flows (create, course, suggest, manual group edits, CSV, print) are unchanged.
