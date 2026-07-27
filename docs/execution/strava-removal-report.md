# Strava removal report

Branch: `rider-self-service-ftp-refinement`. Spec: `docs/adr/0004-remove-strava-entirely.md`.

## Files deleted

- `lib/strava.mjs`
- `routes/strava.js`
- `tests/unit/strava.test.mjs`
- `tests/unit/strava-state.test.mjs`
- `tests/integration/strava.test.mjs`

## Files modified

- **schema.sql** — removed `strava_athlete_id`, `strava_access_token`, `strava_refresh_token`,
  `strava_expires_at`, `last_refined_at`, `calib` from the `riders` CREATE TABLE and the
  `UPDATE riders SET calib = 1 ...` line. Added six idempotent
  `ALTER TABLE riders DROP COLUMN IF EXISTS <col>;` statements so a live Railway DB actually
  loses the columns (CREATE TABLE IF NOT EXISTS is a no-op against an existing table).
- **lib/engine.mjs** — `powerOf` no longer multiplies by `calib`; comment above it rewritten to
  describe only what's left. `computeSheet`'s member objects no longer carry `calib`.
- **routes/helpers.js** — `publicRider`/`engineRider` drop `calib`, `strava`, `lastRefined`.
  Deleted `readCookie` (confirmed via grep it was only called from `routes/strava.js` and
  tested from `tests/unit/helpers.test.mjs`, both now gone/updated).
- **server.js** — removed the `stravaRouter` import and mount. Removed `express.urlencoded()` —
  it existed solely for the `/auth/strava` HTML form POST; no other route parses a form body.
  Reworded the `Referrer-Policy` comment (it referenced the Strava redirect specifically);
  `Referrer-Policy`/`X-Frame-Options` middleware itself is untouched.
- **public/state.js** — dropped `calib` from `ridersById()`, removed `ridePicker` state field
  and its reset in comments, removed the `stravalinked`/`stravaerror` banner branches (now `""`).
- **public/actions.js** — removed `openRidePicker`, `applyRefine`, `autoRefine`,
  `bannerFromRefine`, and `unlinkStrava` (not explicitly listed in the brief, but it called the
  now-deleted `DELETE /api/riders/:id/strava` route and its name fails the case-insensitive
  `strava` grep, so it had to go too). Reworded `riderMailto`'s body text (mentioned Strava).
  `updRiderSelf` and everything else kept.
- **public/views.js** — removed `ridePickerEl` entirely and its call sites, the "FTP from
  Strava" panel in `renderRiderPage`, and from `riderRow` the linked/unlinked pill, the
  Link-Strava anchor, the "Set FTP from Strava" button, and the `lastRefined` readout (now just
  the W/kg micro-line). Trimmed the now-unused imports (`openRidePicker`, `autoRefine`,
  `applyRefine`, `unlinkStrava`). Also reworded three copy strings that mentioned Strava outside
  the OAuth flow itself (the course-upload drop-zone hint, the sign-up FAQ line, the
  post-signup confirmation blurb) — these weren't in the brief's explicit list but were needed
  to satisfy the `git grep -i strava` gate.
- **public/styles.css** — removed the entire "Strava ride picker modal" block (`.modal-back`,
  `.modal*`, `.chk`, `.ridelist`, `.ridecard*`, `.ride-*`, `.tg`/`.tg-*`) after confirming via
  grep that none of those classes are referenced anywhere else in `public/*.js`. Also removed
  `.pill`/`.pill.on`/`.pill.off` — dead the moment the Strava-linked badge in `riderRow` was
  removed, confirmed via grep before deleting.
- **.env.example** — removed `STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET` and the OAuth-callback
  wording on `BASE_URL`.
- **package.json** — description reworded to drop "with Strava refinement".
- **tests/unit/helpers.test.mjs** — updated `publicRider`/`engineRider` fixtures and
  expectations; removed all `readCookie` tests and its import.
- **tests/unit/engine.test.mjs** — removed `calib: 1` from rider fixtures in both tests that had it.
- **tests/integration/events.test.mjs** — removed the "resets any leftover calibration
  multiplier" test and the now-unused `initDb`/`q` import from `db.js`.
- **tests/integration/riders.test.mjs** — removed the `assert.equal(body.strava, false)` line.
- **README.md** — dropped the Strava bullet from "Using it", the `/auth/strava*` and
  `DELETE /api/riders/:id/strava` rows from the API table and the `key=` query-param auth note,
  the Railway "create a Strava API app" deploy step, `lib/strava.mjs` and "calibration" from the
  file table, and rewrote "Testing"/"Honest status" to describe only what's left (no Strava
  route tests, no live-round-trip caveat). Verified every remaining coverage claim against the
  current test files.
- **CONTEXT.md** — deleted the **Refine** and **Calib** glossary entries; **Rider key**'s
  wording no longer mentions "their own Strava link/refine".
- **docs/adr/0001-strava-refinement-ftp-only.md** — added a superseded-by-ADR-0004 note under
  the frontmatter; history below untouched.
- **docs/adr/0003-rider-self-service-via-rider-key.md** — added a note under the frontmatter:
  the Strava-related amendments (nonce cookie, confirmation page, hijack sequence) are withdrawn
  with the integration; the rider-key decision itself stands. History below untouched.

## `git grep` output (exact commands from the brief)

```
> git grep -i strava -- . ':!docs'
schema.sql:ALTER TABLE riders DROP COLUMN IF EXISTS strava_athlete_id;
schema.sql:ALTER TABLE riders DROP COLUMN IF EXISTS strava_access_token;
schema.sql:ALTER TABLE riders DROP COLUMN IF EXISTS strava_refresh_token;
schema.sql:ALTER TABLE riders DROP COLUMN IF EXISTS strava_expires_at;

> git grep -in calib -- . ':!docs'
schema.sql:40:ALTER TABLE riders DROP COLUMN IF EXISTS calib;
```

Both are **not** empty — the one deliberate exception. The brief itself requires
`ALTER TABLE riders DROP COLUMN IF EXISTS <col>;` for all six retired columns, and four of
those six column names literally contain `strava`, one is `calib`. There's no way to name the
column being dropped without naming it. I reworded the comment above the ALTERs (it said
"Strava integration removed" — now "Removed integration") so the only remaining hits are the
six unavoidable `ALTER TABLE ... DROP COLUMN` lines themselves. Everywhere else —
code, comments, tests, README, CONTEXT.md — is clean.

## Test counts

- Unit (`npm test`): **71 → 34** passing, 0 failing.
- Integration (`npm run test:integration`): **54 → 26** passing, 0 failing.
- Both suites run clean; the integration run's stderr shows one expected Postgres
  `duplicate key value violates unique constraint "events_code_key"` log line — that's the
  existing "duplicate custom code returns 409" test intentionally inserting a dupe, not a
  failure.

## `node --check` on touched public/*.js files

`node --check public/state.js`, `public/actions.js`, `public/views.js` — all exit 0.
(`public/styles.css` and `.env.example`/`package.json`/`schema.sql` aren't JS, not applicable.
`public/api.js`, `public/app.js`, `public/course.js`, `public/format.js`, `public/grouping.js`
were read for the import check below but not edited, so not re-checked.)

## Import-resolution check

Went through every import line in every file I touched and confirmed the named export still
exists in the target module by reading that module's current export list:

- `server.js` → `express`, `node:path`, `node:url` (builtins); `./db.js` (`initDb` — present);
  `./routes/events.js`, `./routes/riders.js`, `./routes/groups.js` (each `export default router`
  — present, unedited).
- `routes/helpers.js` → `node:crypto` (builtin); `../db.js` (`q` — present);
  `../lib/engine.mjs` (`DEFAULT_PARAMS`, `computeSheet` — both present, unedited by this change).
  Re-read the full post-edit file: every other export routes/events.js, routes/groups.js,
  routes/riders.js import from it (`getEvent`, `getRiders`, `eventForRider`, `getRider`,
  `requireOrg`, `requireRiderOrOrg`, `publicRider`, `truncate`, `token`, `genCode`, `groupId`,
  `clampGroupSize`, `paramsOf`, `engineRidersById`, `eventPayload`, `asyncRoute`, `baseUrl`) is
  still exported.
- `public/actions.js` → `./state.js` (`state`, `LS`, `riderKeyLS`, `riderIdLS` — present);
  `./api.js` (`api`, `loadEvent`, `syncWork` — present); `./views.js` (`render` — present).
- `public/views.js` → `/engine.mjs` (`cdaOf` — present in `lib/engine.mjs`, unedited);
  `./state.js` (`state`, `app`, `POSITIONS`, `BUILDS`, `SHADES`, `el`, `ridersById`, `LS` — all
  present in the edited file); `./format.js` (`esc`, `fmtDur`, `fmtGap`, `addClock` — present,
  unedited); `./actions.js` (`toLanding`, `detailsMailto`, `copyDetails`, `createEvent`,
  `openExisting`, `patchEvent`, `addRider`, `updRider`, `delRider`, `origin`, `signUp`,
  `riderLink`, `riderMailto`, `copyRiderDetails`, `openRiderPage`, `updRiderSelf` — all present
  in the edited `actions.js`, none of the four removed functions still imported); `./api.js`
  (`api`, `savedEvents` — present); `./grouping.js` (all 11 named imports — present, unedited);
  `./course.js` (`parseCourseFile` — present, unedited).
- Confirmed no remaining file imports `readCookie`, `openRidePicker`, `applyRefine`,
  `autoRefine`, `bannerFromRefine`, or `unlinkStrava` (grepped each name across `public/*.js`
  and `routes/*.js` after the edits — zero hits).

## Hand-traces

**Rider self-service page (`renderRiderPage` in `public/views.js`)**: header strip (event name,
distance, W/kg) → banner if any → a details panel (name/weight/FTP/bike/build inputs, each
`onblur`/`onchange` validated client-side then PATCHed via `updRiderSelf`) → a "Your start"
panel showing the rider's group members, roll-off clock time, predicted duration and front-share
percentage if they're seeded, else a "not grouped yet" message, plus their own rider-page link
for cross-device return. No Strava panel, no ride picker overlay, no `calib`/`strava`/
`lastRefined` field read anywhere in this function post-edit.

**Organiser's rider row (`riderRow` in `public/views.js`)**: name input, weight/FTP number
inputs, bike/build selects, a remove button (if editable), and a single `.rr-tools` line showing
just `${wkg} W/kg`. No linked/unlinked pill, no Link-Strava anchor, no "Set FTP from Strava"
button, no last-refined date. `save()` PATCHes name/w/ftp/pos/build only — matches what
`routes/riders.js`'s PATCH handler and `publicRider` now accept/return.

## Not verified

- Cannot boot the app (`npm start`/`node server.js`) — no `DATABASE_URL` outside the test
  harness, per the task constraints. No claim is made about live UI beyond the hand-traces above
  and the passing integration tests (which do exercise the real HTTP routes against a real,
  disposable Postgres).
- Did not attempt to verify Railway deploy behaviour or the destructive `ALTER TABLE ... DROP
  COLUMN` statements against an actual populated database — only that `initDb()`/`schema.sql`
  runs clean against the embedded-postgres instance the integration suite spins up (it does;
  all 26 integration tests pass against a schema built from the edited `schema.sql`).
