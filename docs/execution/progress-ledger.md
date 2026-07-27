# SDD progress ledger

Plan: `docs/superpowers/plans/2026-07-27-rider-self-service-and-ftp-only-refinement.md`
Branch: `rider-self-service-ftp-refinement`
Branch base (merge-base with main): `3ec5983`
Baseline commit (docs + copy fixes, pre-Task 1): `943d889`

Tasks listed complete below are DONE — do not re-dispatch. Resume at the first
task not marked complete.

## Status

- Task 1: complete (commits 943d889..9df290a, review clean after one fix pass)
- Task 2: complete (commit a5e5f4c, review clean first pass)
- Task 3: complete (commit 465d1ac, review clean first pass)
- Task 4: complete (commit 1f4a386, review clean first pass; no-leak property verified genuine)
- Task 5: complete (commits 1f4a386..d765dfe — impl 0dbe279, fix 1 3c8fd72, fix 2 d765dfe).
  Auth predicate verified sound by two independent opus reviews; no bypass constructible on
  any vector. Fix pass 2 closed the last open finding. I verified the mutation MYSELF
  (removed both guards in `requireRiderOrOrg`, watched the new empty-stored-key test fail
  with `true !== false`, restored via `git checkout`) rather than accept the report — so no
  third review round was dispatched for a 2-line diff.
  LESSON: this implementer once asserted a mutation check it had not run. For any "this test
  would fail if X" claim, require pasted before/after output, and spot-check it.
  GOTCHA: PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM — restoring a file that way
  leaves it dirty. Use `git checkout -- <file>` to restore.
- Task 6 + 6b: code complete (commits d765dfe..c5e76b6 — 1737f9e impl, 70cb5fd state signing,
  c5e76b6 minors). All review findings resolved EXCEPT the parked browser-binding decision
  below. Treated as done for sequencing purposes so Tasks 7-11 (frontend + docs, entirely
  independent of that decision) are not blocked on a human answer.
  Original in-scope auth verified correct by opus — no bypass on
  /auth/strava, rides or refine; config guard confirmed strictly after the auth check.
  BUT review found the hole is still reachable via `/auth/strava/callback`, which trusts an
  UNSIGNED attacker-supplied `state` and attaches Strava tokens to any rider id named in it.
  That route was outside the plan's Task 6 scope — a gap in the PLAN, not the implementation.
  Added Task 6b to close it. Task 6 stays open until 6b lands, because its commit message
  claims Strava linking now requires a key.
- Task 6b: HMAC-sign the OAuth `state` + expiry, verify in the callback — DONE (70cb5fd),
  signing implementation verified sound by opus (unforgeable; signature checked before
  JSON.parse; null-safe on every malformed input traced). NOT in the original plan.
  Decided to fix rather than defer: shipping a live bypass under a commit claiming to have
  closed it is worse than a small scope expansion. 4 Minors + a report correction in flight.

## OPEN DECISION FOR RICH — blocks calling the Strava hole "closed"

Signing binds *which rider* but not *which browser*. The phishing direction of the original
vulnerability is STILL OPEN:
  1. Attacker creates their own event+rider (public endpoints) and gets a legitimately
     signed state for their own rider via curl.
  2. Attacker sends the victim the Strava consent URL carrying that state.
  3. Victim approves with the VICTIM's Strava account.
  4. Callback writes the victim's tokens onto the ATTACKER's rider row.
  5. Attacker reads the victim's ride history (names/dates/distance/power) via
     `GET /api/riders/<own id>/rides` with their own rider key.
The 15-minute expiry is no mitigation — the attacker can mint a fresh state per victim.
A server-side nonce does not help either; the state is fresh and legitimately issued, and it
is the victim's browser that completes the flow.

Only fix is binding state to the initiating browser (short-lived HttpOnly SameSite=Lax cookie
holding a nonce also embedded in the signed state, compared at the callback). That collides
with `docs/adr/0003-rider-self-service-via-rider-key.md`: "Do not 'upgrade' this to cookies or
sessions without revisiting this ADR."

Options: (a) amend ADR-0003 to permit a single-purpose OAuth-binding cookie — RECOMMENDED,
it is the textbook OAuth CSRF defence and does not touch how rider keys work; or (b) record
as an explicitly accepted residual risk in the ADR, on the grounds the attack needs phishing
plus the victim clicking through a Strava consent screen.
DO NOT let any commit message, README, or report claim the hole is closed until this is
settled.
- Task 7: complete (commit 7a60894, review clean first pass). Implementer honestly reported it
  could not boot the app (no DATABASE_URL) and verified by syntax check + unit suite +
  inspection instead — correct behaviour, and the reviewer independently recomputed its
  URL trace table.
- Task 8: complete (commit c0855cb, review clean first pass). Its reviewer also caught a PLAN
  defect that would have made Task 9 dead on arrival: `loadEvent` ended its success path with
  an unconditional `state.mode = "app"`, overwriting the `"rider"` mode `state.js` computes
  from a rider link, so `renderRiderPage` would have been correct and permanently unreachable.
  Plan amended with a new Step 2b + `public/api.js` added to Task 9's file list (commit
  4da7e43); Task 9's brief regenerated from the corrected plan.
- Task 9: complete (commits 4da7e43..cfcd4fe — impl 48b22d4, validation fix cfcd4fe).
  Step 2b mode fix verified working; renderRiderPage robust against every missing-data case
  traced; auth threading correct with organiser defaults preserved. The one Important (blank
  name / zero weight-FTP silently persisting) is fixed and I inspected the diff directly, so
  no third review round was spent on a single-file guard.
  The implementer correctly overrode the brief's commit command, which omitted `public/api.js`
  despite Step 2b requiring it — another small plan defect.
- Task 10: complete (commits cfcd4fe..2ffc762 — impl 5ebee89 after amend, CSS fix 2ffc762).
  Functional rework verified correct: the stale-`course` crash that had been live on this
  branch since Task 3 is gone, ride names escaped everywhere, `minMinutes` threaded with no
  hardcoded literal, disabled buttons genuinely omit their handler, all null/edge cases trace
  safely. The CSS specificity regression (my brief's `.ride-tags .tg` at (0,2,0) was beating
  `.tg-com`/`.tg-pow` at (0,1,0), muting both badges) is fixed via a dedicated `.tg-reason`
  single class. I verified both fixes directly.
  NOTE: commit 6e6d5ca was amended to 5ebee89 to strip a U+FEFF BOM from its subject line.
  I re-checked all 18 branch commits — no BOMs remain.
- Task 11: complete (commit 5fd4d42, review clean first pass). Reviewer independently
  fact-checked every claim against code — all 12 routes, both auth families, both test counts
  (57 unit / 36 integration, re-run), the refinement description and the open-issue paragraph.
  The implementer REFUSED a false claim the brief contained (it would have said
  `public/grouping.js` group-edit ops are unit tested; no test imports that module). The
  reviewer re-verified and confirmed the refusal was correct. Exactly the behaviour wanted.

## FINAL WHOLE-BRANCH REVIEW (opus) — verdict: merge WITH FIXES

Re-ran both suites independently: 57/57 unit, 36/36 integration green. Architecture, auth
predicate, state signing and schema migration all judged sound.

Merge blockers found:
1. CRITICAL — rider is locked out of self-service the moment they link Strava. `state.riderId`
   is only ever read from the `rider` query param and never persisted, so the stored
   `pursuit:riderkey:<code>:<id>` value is unreadable without the id. The Strava callback
   redirects to `/?code=…&stravalinked=1` with no `rider`, so the primary new journey
   (open rider page → Link Strava → approve) dead-ends on the organiser view. Worse, the UI
   says "This device will remember you automatically" and README/ADR-0003 repeat it — all
   false, and they discourage saving the one link that would have helped.
   THIRD plan defect of the same shape: the plan asserts behaviour its own snippet cannot
   deliver (plan lines 1292/1328 vs 1117-1124).
2. IMPORTANT — `PATCH /api/riders/:id` has NO server-side validation, and this branch just
   handed that endpoint to every rider. `{"w":"abc"}` → NaN → stored in a `real` column →
   `groupSpeed` falls to its 0.5 m/s crawl fallback → that group's duration sets `tMax` →
   every other group's start offset shifts. One rider with curl corrupts the start sheet for
   the whole event. The client-side guard added in Task 9 is bypassable from devtools.
Plus: no `Referrer-Policy` while the ORGANISER key travels in a URL that navigates
cross-origin to Strava (ADR-0003 only ever justified *rider* keys in URLs); no Strava unlink
path; the picker's per-ride watts come from Strava summary objects but are re-derived from
detail objects on apply, so the button can promise a number the server won't set.

## FINAL FIXES APPLIED (commits 3c5fb51, 4409987) — all 8 review items resolved

I verified the two blockers directly: `riderIdLS` now persists the id, `state.js` falls back
to it when the URL has no `rider` param, `mode` uses `riderId !== null`, the OAuth callback
redirects with `&rider=${rider}`, and PATCH now 400s on a blank name, a non-finite or
sub-30 weight, and a non-finite or sub-50 FTP. Suite re-run by me: 60/60 unit, 43/43
integration. Working tree clean. No BOMs in any of the 22 commit subjects.

Deferred-minor triage from the final review: only ONE was marked fix-before-merge (the
duplicated Strava freshness filter) and it is done via an exported `freshRides` helper with
unit tests. Everything else was explicitly triaged SHIP AS IS — see the table in that review.
One ledger item was closed HONESTLY as still-uncovered rather than done: the auto-pick
"suggested == applied" guarantee is verified by trace and unit test, not at route level,
because nothing stubs `fetch`.

## RESOLVED BY REMOVAL (commit 8e35b53, ADR-0004)

Rich's call: "drop strava connection entirely and the related refinement from strava, this
over-complicates everything!" Done. `lib/strava.mjs`, `routes/strava.js` and the three Strava
test files deleted; OAuth, tokens, refinement, ride picker, nonce cookie and confirmation page
all gone; the four token columns plus `last_refined_at` and `calib` dropped via idempotent
`ALTER TABLE ... DROP COLUMN IF EXISTS` so a live Railway DB actually loses them.

The hijack decision below is now VOID — there are no tokens to steal and no third-party
account to attach. Kept regardless because they cost nothing: `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, and the server-side validation on rider PATCH.

Rider self-service SURVIVES intact — rider keys, `requireRiderOrOrg`, the rider's own page,
own-row editing. That was the organiser-workload win and never depended on Strava.

Suites: 71→34 unit, 54→26 integration, all passing (I re-ran both). The only remaining
`strava`/`calib` strings outside `docs/` are the six unavoidable DROP COLUMN statements.

### Historical — the decision this replaced (kept for the reasoning, no longer actionable)

## OAUTH HIJACK — root cause found, THREE fixes attempted, still open

Rich approved amending ADR-0003 to permit a browser-binding cookie. That was implemented
(93d6bf2), then a confirmation step (0f8f62e). Review killed both as complete fixes:

- Nonce cookie closes only the harvested-strava.com-URL route. It does NOT close the attacker
  sending the app's own `/auth/strava?...&key=<attacker key>` link: the victim's browser then
  performs both legs honestly, so the nonce matches.
- Confirmation page naming the rider does NOT close it either: names are free text with no
  uniqueness constraint, `GET /api/events/:code` is unauthenticated, and sign-up is public, so
  the attacker clones the victim's name into the victim's own event. The victim sees their real
  name and truthfully answers "yes that's me".
- ROOT CAUSE, and it is not Strava-specific: `public/state.js` auto-adopts any `?key=` in the
  URL as that browser's rider identity. Anyone who sends you a link can put your browser into
  another rider's session. Every downstream control is a speed bump.

I was wrong three times that a given fix closed this. Each fix moved the attack one hop.
STOP PATCHING. This is a decision about ADR-0003's central choice.

Options for Rich (revised — my first framing of these was also weak; an "is this you?"
interstitial on key adoption fails to the SAME name-cloning trick as the confirmation page):

(a) Accept and document precisely. Zero further code. The attack needs the victim to click a
    phishing link AND click through a genuine Strava consent screen. Defensible at club scale,
    and the README already records it honestly.
(b) Make rider names unique per event (normalised: trim, collapse whitespace, casefold) with a
    409 on collision at sign-up. This is the one cheap change that makes the confirmation
    page's premise TRUE — the attacker can no longer clone the victim's name into the victim's
    event, so the victim really does see a name that isn't theirs. Not airtight (homoglyphs,
    near-miss spellings), and it blocks two genuine Daves from signing up without surnames —
    but that is arguably better on a start sheet anyway. Biggest security gain per line changed.
(c) Rider keys stop travelling in URLs. Cross-device access becomes a short code the rider
    types in, or email delivery. Closes the whole class properly, including the auto-adoption
    root cause. Biggest UX cost and it revises ADR-0003's foundation.

Recommendation: (b) now, and treat (c) as the real answer if this ever outgrows a club.
Caveat worth stating plainly: I have been wrong three times on this today, so (b) deserves an
adversarial review of its own before it is trusted, not just implementation.

What the three commits DID achieve and is worth keeping regardless: harvested-consent-URL
variant dead, flow no longer a drive-by GET, already-linked athlete can't be silently
re-attached, `Referrer-Policy: no-referrer`, and a real happy-path + mutation-verified test set.

## STILL OPEN — needs Rich

Task #13, the OAuth browser-binding decision (see the section above). Everything else on this
branch is complete. The branch has NOT been pushed and NOT been merged — deliberately, since
that decision affects what the README should ultimately say about the Strava flow.

## Minor findings deferred to the final whole-branch review

- ~~Task 1 / `routes/strava.js` course-mode guard + wasted Strava fetch~~ — RESOLVED by
  Task 3; its reviewer independently confirmed no `mode` token, no `!ev.course_json` guard,
  and no always-failing fetch path remain in the file.
- Task 2 / `routes/strava.js` `pickSuggested`/`sortRides` — no test covers two eligible rides
  tied on `ftpEstimate`. Behaviour (stable sort preserves input order) is correct but
  implicit and undocumented.
- Task 2 / `routes/strava.js` `isRide` — promoted to a named export with no direct unit
  test. Inherited from the brief's test list, not introduced by the implementer.
- Task 3 / `routes/strava.js:95-98` vs `119-121` — the `isRide(a) && start_date >= cutoff`
  filter and the `cutoff` computation are duplicated verbatim between the GET rides and
  POST refine handlers. **Labelled plan-mandated** (the plan's own snippets contain the
  duplication), so deliberately NOT fixed unilaterally mid-run. A ~3-line `freshRides(acts)`
  helper would remove the drift risk. Final review to triage — decision belongs to Rich.
- Task 3 / both Strava handlers have no automated coverage until Task 6's integration tests
  land. The auto-pick "suggested ride == applied ride" guarantee was verified by manual
  trace only. Re-check this is genuinely covered once Task 6 is in.
- Task 4 / `tests/integration/riders.test.mjs:103` — `assert.equal(listed.riders[0].riderKey,
  undefined)` adds nothing: `publicRider` is a whitelist so a camelCase `riderKey` could
  never appear there. The real guard is line 104's `rider_token` check, which would genuinely
  fail on a leak. Harmless but misleading to a future reader.
- Task 5 / `routes/helpers.js:54` vs `:65` — the organiser-token comparison now exists in two
  places (`requireOrg` and `requireRiderOrOrg`). It is auth logic with differing test
  coverage per copy. A shared `isOrg(ev, req)` predicate would remove the drift risk.
  Deferred: extracting it mid-run touches both auth paths at once.
- Task 5 / `routes/riders.js:22-23`, `:35-36` — `eventForRider` and `getRider` are two
  separate round trips on the same id, on the hot self-edit path. Correct but halvable with
  one joined query. Task 6 reuses this shape, so change both together or neither.
- Task 5 / `routes/helpers.js:30` — `isNumericId` is unexported and has no unit test, so the
  int4 boundary (2147483647) is pinned only by a far-out-of-range integration case. An
  off-by-one (`< 2147483647`) would 404 the largest legitimate rider id with the suite green.
- Task 5 / `tests/unit/helpers.test.mjs:75-83` — asserts status codes only. A `fakeReq` whose
  `get()` throws would cheaply pin "no credential is read on the 404 path", which is
  currently a code-reading guarantee rather than a tested one.
- Task 5 / `requireRiderOrOrg` 404-vs-403 lets an unauthenticated caller enumerate which
  rider ids exist. Inherent to the contract the plan specifies and consistent with the
  existing `requireOrg`. Recorded so the choice is explicit, not accidental.
- Task 6b / `lib/strava.mjs` `verifyState` — the expiry check is `Date.now() - payload.ts >
  window`, guarded only by `"ts" in payload`. A non-numeric `ts` makes that arithmetic NaN,
  `NaN > window` is false, and the state is treated as never-expiring. NOT attacker-reachable
  (a forged payload needs the HMAC secret, and we only ever sign `ts: Date.now()`), so this is
  latent robustness, not a live hole. One-line fix: also require `typeof payload.ts ===
  "number"`.
- Task 7 / `public/state.js` `mode: riderId && riderKey ? "rider" : ...` — truthiness on
  `riderId` means a rider id of `0` plus a valid key would resolve to `"app"`, not `"rider"`.
  **Labelled plan-mandated** (copied from the plan's own snippet). Unreachable today:
  `riders.id` is `SERIAL PRIMARY KEY`, which starts at 1. `riderId !== null && riderKey` would
  be more robust. Final review to triage.
- Task 7 / `public/api.js` — `auth === "rider"` is an exact case-sensitive match; any other
  truthy string (`"Rider"`, a typo) silently falls to the organiser branch and sends an EMPTY
  `x-organiser-token` rather than erroring. No current call site does this, but Tasks 9-10 add
  rider-side call sites, so every one of them must pass the exact literal `"rider"`.
- Task 9 / `public/views.js` `riderRow` (the ORGANISER's rider editor, ~line 210) still has the
  same unguarded save that was just fixed on the rider page: a blank name persists as `""`
  because `truncate()` only falls back on `null`, and a cleared number field sends `0`.
  Deliberately NOT fixed — the organiser UI is outside this plan's scope, and the rider case
  was the urgent one (newly exposed to non-technical users with nobody watching). Worth a
  follow-up; the guard from `renderRiderPage` can be lifted almost verbatim.
