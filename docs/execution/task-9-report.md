# Task 9 report: Rider self-service page

## What I implemented

Followed the brief exactly, including Step 2b.

1. **`public/actions.js`**
   - Replaced `openRidePicker`, `bannerFromRefine`, `applyRefine`, `autoRefine` with the brief's versions: all now take a trailing `auth = true` parameter that is passed straight through to `api()`. `openRidePicker` now stores `state.ridePicker = { riderId, rides, suggestedId, minMinutes, auth }` (matches Task 3's response shape: `rides`, `suggestedId`, `minMinutes` — no more `course`/`hideCommutes`). `bannerFromRefine` now reads `r.matched`, `r.message`, `r.hadPower`, `r.ftp`, `r.activity` (Task 3's shape) instead of the removed `r.mode`/`r.effectiveFtp`/`r.calib`/`r.distanceKm`.
   - Appended `updRiderSelf(id, body)`, which PATCHes `/riders/:id` with auth `"rider"` (literal string) and reloads via `loadEvent`.

2. **`public/api.js`** (Step 2b) — `loadEvent`'s success path now sets `state.mode = state.riderId && state.riderKey ? "rider" : "app"` instead of unconditionally `"app"`, with a comment explaining why. The `catch` branch is untouched.

3. **`public/views.js`**
   - `render()` now checks `state.mode === "rider" && state.data` before the landing-screen fallback, routing to a new `renderRiderPage()`.
   - Added `updRiderSelf` to the action-import line (line 4).
   - Added `renderRiderPage()` (placed immediately above the actual `/* ---- rider self sign-up -------------------------------------------------- */` comment — the brief's brief shortened that comment's dashes; I used the real one from the file so the anchor matched) with three panels: rider details (name/weight/FTP/position/build, editable, save-on-blur/change via `updRiderSelf`), FTP-from-Strava (link/re-link with `key=` URL-encoded, "Update my FTP from a ride" button that calls `openRidePicker(me.id, "rider")`), and "Your start" (group members, roll-off time, predicted time, or an empty-state message if ungrouped). Handles the rider-not-found case (removed by organiser) with a dedicated screen and a re-sign-up link.

## Verification performed

- `node --check public/actions.js; if ($?) { node --check public/views.js }; if ($?) { node --check public/api.js }` → no output, exit clean on all three.
- `npm test` → `tests 57 / pass 57 / fail 0`, full output confirmed (all suites listed, ending `ℹ fail 0`).
- `git grep -nE "effectiveFtp|impliedCalib|\.matches" -- public` (Step 1b) → three matches, all in `public/views.js`'s existing `ridePickerEl` (`rd.matches`, `rd.impliedCalib` — the function Task 10 replaces wholesale). Zero matches in `public/actions.js`. Matches the brief's expectation exactly.

### Name-by-name import resolution check

`public/views.js` imports, checked against each source file's actual `export` lines (grepped `^export` in each):
- From `./state.js`: `state, app, POSITIONS, BUILDS, SHADES, el, ridersById, LS` — all eight present as `export const`.
- From `./format.js`: `esc, fmtDur, fmtGap, addClock` — all four present as `export const`.
- From `./actions.js`: `toLanding, detailsMailto, copyDetails, createEvent, openExisting, patchEvent, addRider, updRider, delRider, openRidePicker, autoRefine, applyRefine, origin, signUp, riderLink, riderMailto, copyRiderDetails, openRiderPage, updRiderSelf` — all 19 confirmed present via `grep '^export' public/actions.js`, including the newly added `updRiderSelf` (line 111) and the already-existing rest.
- From `./api.js`: `api, savedEvents` — both present.

`public/actions.js` imports: `state, LS, riderKeyLS` from `./state.js` (all three exported), `api, loadEvent, syncWork` from `./api.js` (all three exported), `render` from `./views.js` (exported). No new imports were added to this file in this task.

`public/api.js` was not given any new imports; the one line changed only references `state.riderId`/`state.riderKey`, and `state` was already imported at the top of the file.

I did this by grepping `^export` in `state.js`, `format.js`, `api.js`, and `actions.js` and manually matching every name on each import line against that list — not by assuming the brief was self-consistent.

## Hand-trace 1: rider arriving at `/?code=abc&rider=7&key=deadbeef`

1. **Module load / `state.js`**: `params.get("code")` = `"abc"` → `startCode = "abc"`. `qRider = "7"`, matches `/^\d+$/` → `riderId = 7`. `qKey = "deadbeef"`. Since `startCode && riderId` are both truthy: `riderKey = qKey = "deadbeef"`, and because `qKey` is truthy, `LS.setItem(riderKeyLS("abc", 7), "deadbeef")` persists it for next time. `state.mode` is computed as `riderId && riderKey ? "rider" : ...` → `"rider"`. `state.code = "abc"`, `state.riderId = 7`, `state.riderKey = "deadbeef"`, `state.signup = false` (no `signup=1` param). `state.token` is then set from `LS.getItem("pursuit:token:abc")` (organiser token for that code, if any — irrelevant to the rider path, just population of an unused field).
2. **`app.js` bootstrap**: `state.signup` is false, `state.code` (`"abc"`) is truthy, so `loadEvent()` runs (not the bare `render()` branch).
3. **`loadEvent()`** (`public/api.js`): `state.code` is truthy so it doesn't early-return to landing. No `saving` in flight. It awaits `api("/events/abc")` (no auth arg → GET with only `Content-Type` header — event GET is public). On success: `state.data` is set, `LS.setItem("pursuit:lastCode","abc")`, `syncWork()` populates `state.work`, then **the Step 2b line**: `state.mode = state.riderId && state.riderKey ? "rider" : "app"` → both truthy → `state.mode = "rider"` (recomputes the same value `state.js` already set, rather than stomping it to `"app"`). Then `render()` is called.
4. **`render()`** (`public/views.js`): `state.signup` false → skip. `state.mode === "rider" && state.data` → true (mode is `"rider"`, data just loaded) → **`renderRiderPage()` runs.** This is the function that finally renders.

If the event code were wrong, `api()` would throw, `loadEvent`'s `catch` sets `state.data = null; state.mode = "landing"; state.banner = "Couldn't find event…"`, and `render()` would hit `state.mode === "landing" || !state.data` → `renderLanding()` — same as any bad code, rider or not, as intended.

## Hand-trace 2: rider not in `state.data.riders`, and organiser with no groups yet

- **Rider removed by organiser**: `renderRiderPage()` does `const me = (state.data.riders || []).find((r) => r.id === state.riderId)`. If the organiser deleted that rider, `me` is `undefined`. The function immediately renders the "NOT FOUND" screen (escaped `state.code`, a link back to `/?code=...&signup=1`) and `return`s — none of the later code that dereferences `me.*` ever executes. No throw.
- **No groups yet**: `routes/helpers.js`'s `eventPayload()` always returns `sheet: ev.course_json ? computeSheet(...) : { rows: [], tMax: 0, tMin: 0 }` — `state.data.sheet` is never absent, always at least `{ rows: [], ... }`. So `mine = state.data.sheet?.rows?.find(...)` evaluates safely to `undefined` when `rows` is empty (or when the rider isn't in any row yet). `renderRiderPage`'s "Your start" panel ternary on `mine` then renders the `<p class="empty">Your organiser hasn't put you in a group yet…</p>` branch instead of dereferencing `mine.members`/`mine.offset`/`mine.dur`. No throw. (The `?.` in `state.data.sheet?.rows?.find` is technically redundant given `sheet` is always populated, but it's harmless defensive code, not a bug.)

## Self-review

- Every rider-authenticated call site added/touched passes the exact literal string `"rider"`: `updRiderSelf` → `api(..., "rider")`; the rider page's refine button → `openRidePicker(me.id, "rider")`. Confirmed by reading the final file content, not just the diff.
- The Strava link URL: `href="/auth/strava?code=${encodeURIComponent(state.code)}&rider=${me.id}&key=${encodeURIComponent(state.riderKey)}"` — `state.riderKey` is `encodeURIComponent`-ed; `state.code` is too; `me.id` is a numeric rider id (server-assigned integer), not user-editable text, so it's not an injection vector and matches how the organiser's equivalent link in `riderRow` treats `r.id`.
- All interpolated rider-controlled strings in `renderRiderPage`'s HTML go through `esc()`: `esc(state.code)` (not found screen), `esc(ev.name)`, `esc(me.name)` (panel heading and the `value=` on the name input), `esc(m.name)` for each group member in "Your group", and `esc(new Date(me.lastRefined).toLocaleDateString())` (date string, not user text, but escaped anyway per the brief's code — harmless). The one *not* using `esc()` is the `riderLink(...)`'s inner `value=` attribute — but `riderLink()` builds a URL from `encodeURIComponent`-ed parts, so it's already attribute-safe.
- `card.querySelector("#r-name").value` and friends flow into `updRiderSelf`'s PATCH body — this is user-typed data going to the API, not into HTML, so `esc()` doesn't apply there; that's correct, matching how `updRider`/`addRider` already work elsewhere in the file.
- Confirmed `state.data.sheet` can't be absent (see Hand-trace 2) and `me` being undefined is handled before any other dereference — so the two throw-scenarios named in my brief's self-review checklist are both safe.
- Existing organiser call sites (`riderRow`'s `openRidePicker(r.id)`, `ridePickerEl`'s `autoRefine(riderId)`/`applyRefine(riderId, rd.id, "course"|"power")`) still work: `auth` defaults to `true` for the first two; the third argument to `applyRefine` at the two `ridePickerEl` call sites is now interpreted as `auth` rather than the old `mode`, but since those call sites only ever run from the organiser-only `riderRow` surface and any truthy non-`"rider"` value takes the `else if (auth)` organiser-token branch in `api()`, behaviour there is unchanged (still sends `x-organiser-token`). This mismatch is cosmetic/leftover, not a functional bug, and is exactly what Task 10 replaces wholesale (confirmed by reading Task 10's brief in the plan doc — it rewrites `ridePickerEl` entirely and drops the stray third arguments).

## A real bug I found — pre-existing, not introduced by this task, out of scope for Task 9

`ridePickerEl` (untouched by this task; Task 10's job) destructures `const { riderId, rides, course, hideCommutes } = state.ridePicker;` and then does `course.distanceKm` unconditionally in its template. Since Task 3 already removed `course` from the `/riders/:id/rides` response (confirmed: `routes/strava.js:107` returns only `{ rides, suggestedId, minMinutes }`), `state.ridePicker.course` is `undefined` — this was already true before my changes, since even the *old* `openRidePicker` did `course: r.course` with `r.course` already missing. So **opening the ride picker at all (organiser's "Refine" button or my new rider-page "Update my FTP from a ride" button) currently throws a `TypeError` inside `ridePickerEl` and would crash that render.** I did not fix this because:
- It's explicitly the ride-picker *markup* that Task 10 owns ("Task 10 changes only the picker's markup and consumes these signatures unchanged" — brief's own words).
- I confirmed by reading the plan document's Task 10 section that it replaces `ridePickerEl` wholesale with a version that destructures `{ riderId, rides, suggestedId, minMinutes, auth }` (no `course`) — exactly fixing this.
- Task 9's wiring (`openRidePicker(me.id, "rider")` → correct auth, correct `state.ridePicker` shape) is correct and will work once Task 10 lands; the brief says as much: "the wiring is already correct here — clicking 'Update my FTP from a ride' must open the picker and send the rider's key (no 403), even though the layout is still the old one." I read this as the brief author expecting a stale-*looking* layout, not a crash — worth flagging explicitly since it's more than cosmetic until Task 10 merges.

## What I could NOT verify

I did not run the app. There is no `DATABASE_URL`/live Postgres available to me in this environment, so I could not: start the server, sign a rider up through the UI, click "Open my rider page," edit fields and confirm persistence across reload, confirm the "Your start" panel against a real Suggest-generated sheet, or exercise the picker crash described above in an actual browser. Everything above is verified by reading source (both the files I changed and their collaborators: `public/state.js`, `public/format.js`, `routes/helpers.js`, `routes/strava.js`, `routes/riders.js`, the plan document's Task 10 section) and by the two automated checks (`node --check`, `npm test`) that don't require a database.

## Fix pass (post-review)

Review confirmed the Step 2b fix, the `renderRiderPage` failure-mode handling, escaping/encoding, and the auth-threading defaults, and endorsed both judgment calls (the `ridePickerEl`/`course` crash being pre-existing/out-of-scope, and adding `api.js` to the commit). One finding required a fix: the brief's verbatim `save` handler in `renderRiderPage` sent whatever was in the DOM with no validation, so clearing the name field persisted `name: ""` (the PATCH route, unlike sign-up, doesn't reject blank names), and clearing weight or FTP sent `0` (`+"" === 0`, which passes the server's `!= null` check) — silently corrupting the rider's data with no feedback.

### Change made

In `public/views.js`'s `renderRiderPage`, inside the rider-details `card`:
- Added `<p class="err" id="rerr" style="display:none"></p>` right under the panel's hint text, using the existing `.err` class (already defined in `styles.css:91` and already used by `coursePanel`'s `cerr` with the same show/hide pattern — no new CSS).
- Captured `nameI`, `wI`, `ftpI`, `rerr` as stable DOM references (previously the handler re-queried the DOM inline every call).
- Rewrote `save` to validate before calling `updRiderSelf`:
  - trims the name; rejects blank → shows `"Add your name — it can't be blank."`, restores the input to `me.name`, returns without saving.
  - requires `Number.isFinite(w) && w > 30` → otherwise shows `"That weight doesn't look right — enter your weight in kg."`, restores to `me.w`, returns.
  - requires `Number.isFinite(ftp) && ftp > 50` → otherwise shows `"That FTP doesn't look right — enter your FTP in watts."`, restores to `me.ftp`, returns.
  - on success, hides the error box (`rerr.style.display = "none"`) and calls `updRiderSelf` with the validated/trimmed values.
- `pos`/`build` still read inline via `card.querySelector(...)` at the point of calling `updRiderSelf` (they're `<select>`s, always one of the known option values — no validation needed).
- No server-side files touched, per the coordinator's instruction.

The 30 kg / 50 W floors are deliberately far below any real cyclist (so they only catch blanks/typos, e.g. `+"" === 0` or a stray `"5"`), not something a legitimate rider could plausibly trigger by mistake.

### Verification

- `node --check public/views.js` → no output, exit 0.
- `npm test` → tail of output:
  ```
  ℹ tests 57
  ℹ suites 0
  ℹ pass 57
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```
  57/57 pass, unchanged from before the fix.
- Import check: no new imports were added or needed — `Number.isFinite` is a global, and `el`/`esc`/`card.querySelector` were already in scope. Re-confirmed the `views.js` action-import line and the `state.js`/`format.js` import lines are unchanged from the prior pass.

### Hand-traces (by reading — could not run the app; no live Postgres/`DATABASE_URL` available in this environment, so no browser interaction was performed)

1. **Name cleared, then blurred**: `nameI.onblur = save` fires. `name = nameI.value.trim()` → `""`. `!name` is true → `showErr("Add your name — it can't be blank.")` sets `rerr.textContent` and `display:block`, then `nameI.value = me.name` restores the input to the rider's last-saved name (visually snapping back), then `return` — `updRiderSelf` is never called, so no PATCH request is sent and the server never sees `name: ""`.
2. **Weight cleared** (on a `type="number"` input, `change` fires `onchange = save` when the field loses focus after edit): `wI.value` is `""` → `w = +""` = `0`. Name is presumably still valid so the first guard passes. Second guard: `Number.isFinite(0)` is `true`, but `0 <= 30` → condition `!Number.isFinite(w) || w <= 30` is `true` → blocked. `showErr(...)` shows the weight message, `wI.value = me.w` restores the field to the rider's last saved weight, `return` — no PATCH sent, FTP/pos/build in the DOM are left untouched (per the coordinator's "restore the offending field" instruction, not a full-form revert).
3. **Valid edit after a rejected one**: continuing from trace 2, rider then types a real weight (e.g. `72`) and the field changes again → `save` re-runs. `name` is valid, `w = 72` passes (`Number.isFinite(72) && 72 > 30`), `ftp` (untouched, still `me.ftp` or whatever was last valid) passes. All three guards pass → `rerr.style.display = "none"` clears the previously-shown message, and `updRiderSelf(me.id, {...})` fires with the validated values. The error box does not persist once a subsequent save succeeds.

## Files changed

- `C:\Users\Rich\PursuitCalculator\public\actions.js`
- `C:\Users\Rich\PursuitCalculator\public\views.js`
- `C:\Users\Rich\PursuitCalculator\public\api.js`

## Commit

```
git commit -m "feat: rider self-service page

Riders can edit their own details, link Strava, refine their own FTP, and see
their group and roll-off time — none of which needed to go through the
organiser. Directly cuts the organiser's per-rider workload."
```
Committed as `48b22d4`. Note: the brief's `git add` line only listed `public/actions.js public/views.js`, but Step 2b of the same brief requires editing `public/api.js`, and that file's edit list entry at the top says so explicitly. Omitting it from the commit would have left the fix for the mode-stomping bug uncommitted (i.e. the exact defect this task exists to close). I included `public/api.js` in the `git add` and the commit; the commit message text itself is unchanged from the brief. `git status` after committing shows a clean working tree.
