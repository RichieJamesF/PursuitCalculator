# Task 11 report: Update the docs to match

## Commit

`5fd4d42` — `docs: bring README and glossary in line with the new auth and refine flow`

Files changed: `README.md` (58 insertions / 29 deletions across both files, 2 files changed), `CONTEXT.md`. No files under `lib/`, `routes/`, `public/`, `tests/`, `schema.sql`, or `server.js` were touched.

## What I changed

### README.md
1. **"Using it" section** — replaced the old single "Set the course" bullet and the old "Strava" (calibration-nudge) bullet with:
   - An expanded "Set the course" bullet noting GPX/FIT upload and that physics params are fixed per event (points at ADR-0002).
   - A new "Riders manage themselves" bullet describing the rider-key self-service flow.
   - A rewritten "Strava" bullet describing FTP-from-power-only refinement with the 20-minute floor, and pointing at ADR-0001 for the removed calibration mode.
2. **API block** — replaced with the brief's block verbatim (it checked out against the route files), plus the auth-header paragraph noting `x-rider-token` and `/auth/strava`'s `key=` query param.
3. **Honest status section** — rewrote per Step 3, **with one substantive correction** (see "Deviations" below), and added a new "Known open issue" paragraph per the controller's security-accuracy requirement.

### CONTEXT.md
- Replaced the **Refine** entry's first sentence to name `MIN_EFFORT_SECONDS` instead of the vague "minimum-duration guard," per Step 4. Left the rest of the entry (organiser/self triggerability, ADR-0001 link, `_Avoid_` line) untouched — it was already accurate.

## Claim-by-claim verification table

| Claim (in README/CONTEXT) | Verified against |
|---|---|
| API block: all 12 routes, methods, auth tags, bodies | `routes/events.js`, `routes/riders.js`, `routes/groups.js`, `routes/strava.js` (read in full) — every line matches actual handler behaviour |
| `PATCH`/`DELETE /api/riders/:id` are `(org \| self)` | `routes/riders.js:24,37` call `requireRiderOrOrg` |
| `GET /api/riders/:id/rides` and `POST /refine` are `(org \| self)` | `routes/strava.js:97,116` call `requireRiderOrOrg` |
| `GET /auth/strava?code=&rider=&key=` — key is organiser or rider key | `routes/strava.js:10-21`: `allowed = key === ev.organiser_token \|\| (r.rider_token && key === r.rider_token)` |
| Sign-up response includes `riderKey` | `routes/riders.js:18`: `res.json({ ...publicRider(rows[0]), riderKey })` |
| `publicRider` never leaks `riderKey`/`rider_token` | `routes/helpers.js:50` — shape is `{id,name,w,ftp,pos,build,calib,strava,lastRefined}` |
| Organiser header is `x-organiser-token`, rider header is `x-rider-token` | `routes/helpers.js:59,70,72` (`requireOrg`, `requireRiderOrOrg`) |
| `GET /auth/strava` with no/wrong/other-rider key → 400/403/403 | `routes/strava.js:12,17` (400 on missing, 403 on mismatch); confirmed live by `tests/integration/strava.test.mjs:40-66` |
| "Set FTP from Strava" offers hardest recent qualifying effort, ≥20 min, power present | `routes/strava.js:53` (`MIN_EFFORT_SECONDS = 1200`), `pickSuggested` (line 81-84: filters `eligible && !commute`, sorts by `ftpEstimate` desc) |
| Rides too short/no-power are listed but unusable | `normalizeRide` (`strava.js:65-77`) sets `eligible = ftpEstimate != null && longEnough` but still returns the row; `public/views.js:111` renders a disabled "Can't use" button with a reason |
| Ride picker "states the exact FTP it will set" | `public/views.js:95`: `` `This sets your FTP to <b>${suggested.ftpEstimate} W</b>.` `` |
| No time-based calibration; see ADR-0001 | `docs/adr/0001-strava-refinement-ftp-only.md` — confirms "Use time" / `calibrationFactor` removed |
| Course: "drop a GPX/FIT, or type distance + ascent" | `public/course.js:27` (`parseGpx`), `:39` (`parseFit`); `routes/events.js:39-40` (`courseManual` vs pre-parsed `course`) |
| Physics params fixed per event, not exposed; see ADR-0002 | `docs/adr/0002-drop-per-event-physics-tuning.md` — confirms plumbing stays, feature dropped |
| "Riders manage themselves" bullet: edit weight/FTP/bike/build, link Strava, refine, see group + roll-off time, no organiser involvement | `public/views.js:319-396` (`renderRiderPage`) — every listed capability present (name/weight/FTP/pos/build inputs at 347-351, Strava link/refine at 370-381, group+roll-off at 383-392) |
| "Riders manage themselves ... key shown once, remembered on that device" | `docs/adr/0003-rider-self-service-via-rider-key.md` — "returned once ... auto-saved to localStorage" |
| Rider key lost → org must delete/re-add (existing CONTEXT.md text, unchanged) | Same ADR-0003 paragraph |
| Honest status: engine/grouping/start-sheet-seeding/Strava-ride-model/browser-GPX-parser unit tested | `tests/unit/engine.test.mjs` (grouping+seeding), `tests/unit/strava.test.mjs` (ride model), `tests/unit/course.test.mjs` (GPX via `buildCourse`) |
| `.fit` parser tested for error path only, not a real device file | `tests/unit/course.test.mjs:36-42` — only test is the "no GPS records" throw |
| **Group-edit operations (swap/move/lock/suggest UI) are NOT unit tested, manual only** | `public/grouping.js` exports (`swap`, `moveTo`, `toggleLock`, `breakGroup`, `newGroup`, `goSolo`, `joinBest`) — grepped all of `tests/` for any import from `grouping.js`: zero matches |
| Events/riders/groups/Strava-auth have integration tests against real Postgres via `embedded-postgres`, no Docker | `tests/integration/{events,riders,groups,strava}.test.mjs` exist; `package.json` devDependency `embedded-postgres`; ran `npm run test:integration` — 36 passing, includes the exact auth-check scenarios described |
| "requires a course first" is untested/unreachable | `tests/integration/groups.test.mjs:5-6` comment confirms |
| 57 unit tests / 36 integration tests pass | Ran both — see below |
| **Known open issue paragraph**: signed `state` binds rider not browser; attacker can self-sign-up, mint link, hand to victim; 15-min expiry doesn't help (fresh state per victim); fix needs browser-bound cookie; ADR-0003 blocks that without revisiting | `lib/strava.mjs:14-41` (`signState`/`verifyState` — payload is `{code, rider, ts}`, no browser-identifying data); `routes/strava.js:19` (`state = signState({ code, rider: Number(rider), ts: Date.now() })`); `docs/adr/0003-...md` closing sentence: "Do not 'upgrade' this to cookies or sessions without revisiting this ADR." This is also the controller-specified requirement verbatim, and matches the code exactly — the state payload genuinely carries no browser/session identifier. |
| CONTEXT.md Refine: "a real, sustained effort of at least 20 minutes (`MIN_EFFORT_SECONDS`)" | `routes/strava.js:53` — `export const MIN_EFFORT_SECONDS = 1200;` (1200/60 = 20) |

## Deviations from the brief's literal text

1. **Honest status — dropped "group-edit operations" from the unit-tested list.** The brief's Step 3 replacement text says: *"The engine, grouping, start-sheet seeding, **group-edit operations**, the Strava ride model ... and the browser GPX/FIT parser are unit tested."* I checked: `public/grouping.js` (swap/move/lock/break/newGroup/goSolo/joinBest — the organiser's group-edit operations) has **zero** test coverage — no test file imports from it. This claim as written would have been false. I kept the brief's other five items (engine, grouping-the-algorithm i.e. `suggestGroups`, start-sheet seeding, Strava ride model, GPX parser — all genuinely covered in `tests/unit/`), and preserved the original README's true statement that group-edit operations run client-side and are "exercised manually, but have no automated test coverage yet." I also kept the original's `.fit`-parser caveat (tested for error path only), which the brief's replacement text silently dropped — dropping it would have been a small loss of honesty for no reason, so I kept it.
2. **Also folded the brief's "browser GPX/FIT parser" into "browser GPX parser" + a separate `.fit` sentence** rather than merging them, to preserve that same accurate nuance (only the GPX path — via `buildCourse` — has positive-path tests; `.fit` only has the negative-path test).
3. **Added the controller-mandated "Known open issue" paragraph**, which is not in the brief at all. Per the controller instruction, I did not write anywhere that the Strava-linking hole is "closed"/"fixed"/"resolved" without qualification — the "Strava" bullet in "Using it" and the API block only describe the auth mechanism (organiser-or-rider key required to start `/auth/strava`), never claiming the flow is fully secure. The one place the brief's own text could have implied closure — the API/auth-line description of `/auth/strava` requiring a key — I left as a factual description of the mechanism (it does require a key now, that part is true and closed: unauthenticated linking is gone), and put the residual browser-binding gap only in the dedicated Honest-status paragraph, so the two true-but-distinct facts (some auth now required vs. full attack surface not closed) aren't conflated.
4. No other deviations — the API block, auth-header paragraph, and "Using it" bullets matched the brief's text as given after verification.

## Step 5 grep (run exactly as specified)

```
git grep -n "matchByDistance\|Use time\|impliedCalib\|calibrationFactor" -- README.md CONTEXT.md
```

Output:
```
CONTEXT.md:14:_Avoid_: Calibrate, Use time (removed mode)
CONTEXT.md:32:now-removed "Use time" mode that tried to back-solve it from an arbitrary ride's moving
```

Matches only the deliberate historical reference in CONTEXT.md's `_Avoid_` line (and its surrounding sentence) for **Refine** — nothing in README.md. Matches the brief's expected result exactly.

Also ran the plan-level check `git grep -n "calibrationFactor\|impliedCalib\|effectiveFtp"` filtered to exclude `docs/` — no output (no matches outside `docs/`).

## npm test / npm run test:all output (tail)

`npm test`:
```
ℹ tests 57
ℹ suites 0
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm run test:integration` (also re-run as part of `npm run test:all`):
```
ℹ tests 36
ℹ suites 4
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm run test:all` completed with both suites green (unit 57/57, integration 36/36). The stderr noise about `NativeCommandError`/`DEP0190` and a `duplicate key value violates unique constraint "events_code_key"` Postgres log line are pre-existing harness/test-fixture chatter (the duplicate-code test deliberately triggers that constraint to verify the 409 path) — not failures; exit reflected 0 passing counts, no `fail` entries.

## BOM check

```
git log -1 --format=%s | Format-Hex | Select-Object -First 2
```
```
00000000   64 6F 63 73 3A 20 62 72 69 6E 67 20 52 45 41 44  docs: bring READ
```
First byte `64` (`d`) — not `EF`. No BOM.

## Self-review

- Re-read the full README and CONTEXT.md after editing. Every sentence I added or changed is backed by a file:line citation in the table above.
- The "Honest status" section still admits real gaps (group-edit UI untested, `.fit` positive-path untested, live Strava round-trip unverified, the `/suggest` guard unreachable, and now the browser-binding gap) rather than reading as a sales pitch — matches the existing tone and the repo owner's stated preference.
- Did not claim the Strava auth hole is closed/fixed/resolved anywhere. The API description says `/auth/strava` "requires a key" (true, and a real improvement over the prior no-auth-at-all state) without asserting the flow is now fully secure; the residual attack is described only in the dedicated paragraph, with ADR-0003 cited as the reason it's an open decision rather than an oversight.
- Left the "What's what" table's `lib/engine.mjs ... calibration` line and the "Testing" section's "physics/grouping/calibration engine" phrase untouched — both are literally true (the engine still multiplies by `calib`, now pinned at 1 per ADR-0001) and outside the brief's specified edit scope; touching them would have been scope creep beyond Steps 1-4.
- No code files were modified; `git status --short` after committing shows only `README.md` and `CONTEXT.md` were ever touched.

## Concerns

None blocking. One judgment call flagged above (dropping the false "group-edit operations are unit tested" claim) — I'm confident in it given the direct evidence (no test file references `public/grouping.js`), but flagging it explicitly since it's a departure from the brief's literal text, per the task's instructions to surface exactly this kind of brief-vs-code mismatch.
