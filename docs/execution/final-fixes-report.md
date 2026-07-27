# Final whole-branch review fixes — report

Branch: `rider-self-service-ftp-refinement`. Working directory:
`C:\Users\Rich\PursuitCalculator`. This report covers items 1-8 from the
final review brief, in the order given.

Commits produced:

- `3c5fb51` — `fix: close rider Strava-link lockout and validate rider PATCH input`
  (items 1, 2, and 7 — 7 is bundled in here, see note below)
- `4409987` — `fix: extract Strava freshness filter, unlink route, truthful watts, honest copy`
  (items 3, 4, 5, 6, 8)

Both commits pass `npm run test:all` at the point they were made (verified
by temporarily reverting the later hunks, running the suite, then
re-applying — see "Commit-splitting method" below). The tree is clean
(`git status --short` empty) after the second commit.

## Note on item ordering across commits

Item 7 (refuse a Strava athlete already linked to a different rider in the
same event) touches the exact same `router.get("/auth/strava/callback", ...)`
handler as item 1's redirect fix — the new duplicate-athlete check and the
new `rider=` query param both sit in the lines immediately around
`const tok = await exchange(authCode)`. Splitting that one hunk between two
commits would have meant hand-editing a git patch with no interactive
terminal available (git add -p needs one; this environment's PowerShell
runs non-interactively). I judged reproducing the mistake-prone patch
surgery not worth it for a same-file, same-handler, both-security-relevant
pair of changes, so item 7 shipped in the blocker commit instead of the
second one. This is called out here rather than left implicit.

One further small bleed: `public/actions.js`'s `unlinkStrava` helper
(added for item 5) ended up staged into the first commit too, because I
staged that file in one shot before splitting `routes/strava.js`. It's an
inert, unused export at that point in history (nothing calls it until the
views.js wiring lands in the second commit), so it doesn't create a broken
intermediate state, but it means the file boundary isn't a perfectly clean
per-item split either.

## Commit-splitting method

To keep the two "blockers first" commits each independently green, I:
1. Made all eight items' edits to the working tree.
2. Temporarily reverted the item 3/5/6 hunks in `routes/strava.js` (and
   the corresponding tests in `tests/unit/strava.test.mjs` and
   `tests/integration/strava.test.mjs`) back to their pre-change form,
   leaving only the item 1 redirect fix and item 7 dupe-check in place.
3. Ran `npm run test:all` — clean (60 unit / 43 integration) — then
   committed items 1+2(+7).
4. Re-applied the reverted hunks exactly (freshRides extraction, detailed
   suggested-ride re-fetch, unlink route, and their tests).
5. Ran `npm run test:all` again — clean (60/43) — then committed the rest.

## Item-by-item

### 1. CRITICAL — rider locked out of self-service after linking Strava

Root cause confirmed as described: `public/state.js` derived `riderId`
only from `?rider=`, never persisted it; `riderKey` was stored under
`pursuit:riderkey:<code>:<id>`, a key unreadable without the id; the
OAuth callback redirect in `routes/strava.js` carried neither.

Fix:
- `public/state.js`: added `riderIdLS(code)` → `pursuit:riderid:<code>`.
  When a `?key=` arrives, both the key (as before) and the id are now
  persisted. When `?rider=` is absent from the URL, `riderId` falls back
  to the stored value. `mode` now tests `riderId !== null` instead of a
  truthy check (matches the brief; also applied the same fix to the
  equivalent check in `public/api.js`'s `loadEvent`, since it's the exact
  same code smell in the exact same variable — riderId is a serial PK
  starting at 1 so this is defensive rather than a live bug, but kept
  consistent with the instruction).
- `public/actions.js`: `signUp` now also writes `riderIdLS(code)` alongside
  the existing `riderKeyLS` write.
- `routes/strava.js`: the callback redirect is now
  `` `/?code=${encodeURIComponent(code)}&rider=${rider}&stravalinked=1` ``
  — carries the rider id, never the key.
- Left the "this device will remember you" sign-up copy (`renderSignedUp`
  in `public/views.js`) and the matching README line untouched, since the
  brief says they become true once the bug is fixed and should not be
  edited.

Verified: `npm test` and `npm run test:integration` green after the
change (see full output below). I did **not** manually drive a real
Strava OAuth round-trip through a browser — there's no `DATABASE_URL` for
a dev server in this environment and no live Strava app credentials here,
so I can't and won't claim to have watched the actual redirect happen in
a browser. The fix is verified by code inspection of the three files plus
the full test suite; the specific "link Strava then land back on my own
page" browser flow is unverified by me, same as it was pre-existing
untestable-without-live-Strava territory per the README's Honest status
section.

### 2. IMPORTANT — no server-side validation on `PATCH /api/riders/:id`

`routes/riders.js` now:
- Rejects `w`/`ftp` that don't parse to a finite number, or that are
  ≤30 kg / ≤50 W respectively (matching the client's floors in
  `public/views.js`'s rider self-edit `save()`), with a 400 naming the
  field ("Weight must be a number above 30 kg.", "FTP must be a number
  above 50 W.").
- Rejects a name that trims to empty ("Name can't be blank."), and stores
  the trimmed value rather than a value with stray whitespace.
- Leaves `pos`/`build` as before (falls back to the existing value if
  omitted) — not in scope per the brief.

New integration tests in `tests/integration/riders.test.mjs`:
`PATCH /api/riders/:id rejects a non-numeric weight instead of persisting
NaN` (also asserts the stored weight is unchanged, not `NaN`), `... rejects
a blank name` (asserts the stored name is unchanged), `... rejects an
out-of-range FTP`, and `... still succeeds with a valid edit alongside the
new validation`.

### 3. Extract the duplicated Strava freshness filter

Added `export function freshRides(acts)` to `routes/strava.js` (six-week
cutoff + `isRide`), used by both `GET /api/riders/:id/rides` and
`POST /api/riders/:id/refine`'s auto-pick branch, replacing the two
independent inline copies.

Unit tests added to `tests/unit/strava.test.mjs`: a ride inside the
six-week window, one outside it, and a non-ride `type`/`sport_type` inside
the window.

### 4. `Referrer-Policy` header + ADR amendment

Added `res.setHeader("Referrer-Policy", "no-referrer")` as the first
middleware in `createApp()` in `server.js`, applied to every response.

Amended `docs/adr/0003-rider-self-service-via-rider-key.md`'s Consequences
section with a new bullet noting the organiser's own Strava link in
`riderRow` also carries a key in a URL (the whole-event organiser token,
not a single-rider key), that the existing "grants edit rights over
exactly one rider row" reasoning doesn't cover that case, and that
`Referrer-Policy: no-referrer` is the mitigation.

Not independently testable by an automated test (it's a static header on
every response) — verified by reading the middleware registration and by
the fact the app still boots under the test harness (`npm run
test:integration` starts a real server via `createApp()` and every request
in that suite goes through it, so a crash in the middleware would have
shown up as wholesale test failure — it didn't).

### 5. Strava unlink route

Added `DELETE /api/riders/:id/strava` in `routes/strava.js`, behind
`requireRiderOrOrg`, nulling `strava_athlete_id`, `strava_access_token`,
`strava_refresh_token`, `strava_expires_at`. Wired an "Unlink Strava"
button into the rider's own page in `public/views.js` (shown only when
`me.strava` is true), calling a new `unlinkStrava(id, auth)` in
`public/actions.js` — the rider page passes the literal `"rider"` string
as required. Added a confirm() prompt before unlinking. Documented the
new route in `README.md`'s API table.

Integration tests added to `tests/integration/strava.test.mjs`: auth
rejection with no token, and that all four columns are actually cleared
(seeded directly via `q()` since there's no live Strava to link through).

### 6. Truthful suggested-ride watts

In `GET /api/riders/:id/rides`, after `pickSuggested` picks the headline
ride, the handler now fetches that one ride's **detailed** activity via
the existing `activity()` helper and overwrites `suggested.ftpEstimate`
with the detailed-derived value (wrapped in try/catch so a transient
failure to fetch the extra detail falls back to the summary estimate
rather than failing the whole listing).

I went one step further than the brief's literal wording: the brief says
only the GET handler needs the extra fetch. But `POST /refine`'s no-id
("auto-pick") branch — which is exactly what the suggested card's "Use
this ride" button triggers — was resolving the chosen ride from the
**summary** object list (`fresh.find(...)`), not a detailed fetch. Left
as the brief describes, the GET-side fix would have made the *displayed*
suggested number more accurate while the *applied* number (via
auto-refine) stayed on summary data — reintroducing the exact
mismatch the fix is meant to close, just relocated. So I changed that
branch to `await activity(access, best.id)` as well, mirroring the
explicit-`activityId` branch immediately above it. Both branches now
resolve through the detailed endpoint, so "the number shown is the number
that gets set" holds for the suggested ride specifically, which is what
the brief's own success criterion asks for.

For the other (non-suggested) rides in the picker, `public/views.js`'s
button label changed from `` `Use · ${rd.ftpEstimate} W` `` to `"Use this
ride"`, and the `title` tooltip from `` `Set FTP to ${rd.ftpEstimate} W` ``
to `"Set your FTP from this ride"` — no exact number is promised for those
any more, per the brief ("keep it proportionate" — no per-ride detail
fetch for the whole list).

### 7. Refuse a Strava athlete already linked to another rider in the event

In the callback handler, before writing tokens, a query now checks for
another rider row in the same event already holding the incoming
`athlete.id`; if found, redirects to `stravaerror=1` instead of writing.

Integration test added: seeds two riders, attaches the Strava athlete id
to one directly via `q()`, then drives the actual callback route for the
*other* rider with a real signed `state` — stubbing only
`globalThis.fetch` for the `/oauth/token` call (Strava's token exchange)
so the rest of the request (including the local test server call itself)
goes through the real `fetch`. The stub is restored in a `finally` block.
This is a new testing pattern for this codebase (no prior fetch-mocking
existed); flagging it explicitly in case a reviewer wants to sanity-check
it — no new dependency was added, it's a plain reassignment of the global.

### 8. Honest copy about visibility

Changed the rider page's line in `public/views.js` from "Only you and
your organiser can edit this." to "Everyone with the event link can see
your numbers below; only you and your organiser can change them." No
other file repeats the old claim (checked with a grep for "Only you and
your organiser").

## Full test output (final state, after both commits)

`npm test`:
```
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm run test:integration` (embedded-postgres, real HTTP against a real
server):
```
▶ events routes (6 tests) — all ✔
▶ groups routes (3 tests) — all ✔
GET /api/health — ✔
▶ riders routes (16 tests, incl. 4 new validation tests) — all ✔
▶ strava routes (16 tests, incl. 2 new unlink tests + 1 new dupe-athlete test) — all ✔

ℹ tests 43
ℹ suites 4
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

(One stray Postgres server-log line appears during the integration run —
`ERROR: duplicate key value violates unique constraint "events_code_key"`
for code `dupe-test` — that's Postgres logging the constraint violation
the pre-existing "duplicate custom code returns 409" test deliberately
triggers and correctly handles; it is not a test failure.)

## What I could not verify

- **No live Strava round-trip.** No `STRAVA_CLIENT_ID`/`SECRET` or
  browser available here; the real OAuth link → approve → redirect →
  land-on-rider-page flow (item 1's actual user-facing fix) is verified
  by code + the one mocked-fetch integration test for item 7's callback
  path, not by watching a browser do it. This was already true before my
  changes (see README's Honest status section) and remains true after.
- **No dev server boot.** No `DATABASE_URL` configured in this
  environment, so I did not start `node server.js` or view any rendered
  page. All frontend changes (`state.js`, `actions.js`, `views.js`) are
  verified by reading the code paths and by the fact the integration
  suite exercises the same server (`createApp()`) the frontend talks to,
  not by rendering the UI.
- **`Referrer-Policy` header**: not covered by an automated assertion
  (no test in the suite checks response headers generally); verified by
  reading `server.js`'s middleware registration.

## What I chose not to do

- Did not add a header-presence integration test for item 4 — the brief
  didn't ask for one, and the existing integration suite has no
  precedent for asserting on response headers generically; adding a new
  testing pattern for a single static header felt like scope creep versus
  the ADR amendment and the header line itself.
- Did not change the organiser's own "Link Strava" / "Re-link" control in
  the main event view (`riderRow` in `public/views.js`) to add an unlink
  option there too — item 5 explicitly asked only for "the rider's own
  page." The organiser can still reach the same `DELETE
  /api/riders/:id/strava` route (it's `requireRiderOrOrg`), just without
  a dedicated button in that view; adding one wasn't requested and would
  have been an unrequested UI change to the organiser's screen.
