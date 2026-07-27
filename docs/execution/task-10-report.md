# Task 10 Report: Rework the ride picker for non-technical riders

## Summary

Replaced the entire `ridePickerEl` function to show one suggested eligible ride upfront with the exact FTP it will set, followed by other rides in a dimmed list with plain-English reasons for ineligibility. Fixed the crash caused by destructuring `course` from a response that no longer contains it.

## Implementation

### Step 1: Rewrote `ridePickerEl` function
- Replaced lines 69-102 of `public/views.js` with new implementation
- Removed reliance on stale `course`, `hideCommutes`, `matches`, `impliedCalib`, `weightedWatts`, `avgWatts`, `avgSpeedKmh` fields
- Now destructures `{ riderId, rides, suggestedId, minMinutes, auth }` from `state.ridePicker`
- Separates suggested ride from others: `suggested = rides.find(...) || null`, `others = rides.filter(...)`
- Displays suggested ride prominently with "Your hardest recent effort" label and exact FTP
- Shows others in a list below, with `.dim` class and disabled "Can't use" buttons when ineligible
- Displays reasons as inline tags: "under N min" or "no power data"

### Step 2: Added CSS rules
- Added to `public/styles.css` (lines 135-136):
  - `.ridecard.dim { opacity: .55; }` — dims ineligible rides to 55% opacity
  - `.ride-tags .tg { background: #eee; color: #555; }` — mutes reason tags to grey, distinguishing them from positive tags

### Step 3: Updated organiser's `riderRow`
- Line 222: Strava link now includes `&key=${encodeURIComponent(state.token)}` to pass organiser token
- Line 223: Button text changed from "Refine" to "Set FTP from Strava" with title describing the action
- Line 221: Calibration readout replaced. Old: `cal ×N.NN` if `r.calib !== 1`. New: "FTP from Strava YYYY-MM-DD" when `r.lastRefined` is set
- Handler at line 229 remains unchanged: `row.querySelector(".refine")` still finds and triggers the button

## Verification

### Step 4: Syntax and stale field check

**Command 1:**
```bash
node --check public/views.js
```
**Result:** No output, exit code 0. ✓

**Command 2:**
```bash
git grep -n "effectiveFtp|impliedCalib|\.matches" -- public
```
**Result:** Exit code 1 (no matches found). ✓

Confirmed: No reads of `rd.matches`, `rd.impliedCalib`, `rd.weightedWatts`, `rd.avgWatts`, or `rd.avgSpeedKmh` remain in `public/`.

### Step 4b: Test suite

**Command:**
```bash
npm test
```
**Result:**
```
✔ 57 tests pass
ℹ duration_ms 706.8151
```
All 57 unit tests still pass. ✓

### Hand-traces

#### Scenario 1: One eligible ride + several ineligible ones

**Input state:**
```
rides: [
  { id: 1, eligible: true, ftpEstimate: 285, hasPower: true, name: "Morning climb", date: "2026-07-20" },
  { id: 2, eligible: false, ftpEstimate: 210, hasPower: false, name: "Evening spin", date: "2026-07-19" },
  { id: 3, eligible: false, ftpEstimate: null, hasPower: false, name: "Commute", commute: true }
]
suggestedId: 1
minMinutes: 20
```

**Execution:**
- `suggested = rides.find(r => r.id === 1)` → ride #1
- `others = rides.filter(r => r.id !== 1)` → [ride #2, ride #3]
- Suggestion section: renders ride #1 as `.ridecard.match` with "Your hardest recent effort", "Morning climb", "This sets your FTP to 285 W", button "Use this ride"
- Ride #2 (ineligible, no power):
  - `reason = why(rd)` → "no power data" (ftpEstimate is not null but eligible is false)
  - Rendered with `.dim` class, "Can't use" button, tag showing "no power data"
- Ride #3 (ineligible, no power):
  - `reason = "no power data"`
  - Rendered with `.dim` class, "Can't use" button, tags showing "commute" and "no power data"

**Output:** Suggestion prominently displayed; others dimmed and disabled with clear reasons. ✓

#### Scenario 2: ALL rides ineligible (suggestedId is null)

**Input state:**
```
rides: [
  { id: 1, eligible: false, ftpEstimate: 150, hasPower: false, name: "Short ride", date: "2026-07-20" },
  { id: 2, eligible: false, ftpEstimate: null, hasPower: false, name: "Easy spin", date: "2026-07-19" }
]
suggestedId: null
minMinutes: 20
```

**Execution:**
- `suggested = rides.find(r => r.id === null)` → null
- `others = rides.filter(r => r.id !== null)` → [ride #1, ride #2]
- Suggestion section: renders `<p class="empty">No ride in the last 6 weeks has power data and lasts 20 minutes or more...`
- Both rides rendered with `.dim` class, "Can't use" buttons, and appropriate reason tags
- List does not show "No other rides..." because `others.length > 0`

**Output:** Empty state message replaces suggestion; all rides shown as unusable. ✓

#### Scenario 3: One eligible ride, also the only ride (others is empty)

**Input state:**
```
rides: [
  { id: 1, eligible: true, ftpEstimate: 275, hasPower: true, name: "Sunday loop", date: "2026-07-21" }
]
suggestedId: 1
minMinutes: 20
```

**Execution:**
- `suggested = rides.find(r => r.id === 1)` → ride #1
- `others = rides.filter(r => r.id !== 1)` → []
- Suggestion section: renders ride #1 prominently
- `if (!others.length)` → list shows `<p class="empty">No other rides in the last 6 weeks.</p>`

**Output:** Suggested ride displayed; "other rides" section shows "No other rides in the last 6 weeks." ✓

#### Scenario 4: A ride with ftpEstimate null

**Input state:**
```
rides: [
  { id: 1, eligible: false, ftpEstimate: null, hasPower: false, name: "Garmin data loss", date: "2026-07-20" }
]
suggestedId: null
minMinutes: 20
```

**Execution:**
- `powerLabel(rd)` where `ftpEstimate == null` → "no power data"
- `why(rd)` → `!eligible ? (ftpEstimate == null ? "no power data" : ...)` → "no power data"
- Card rendered with `.dim` class
- Reason tag: `<span class="tg">${esc("no power data")}</span>`
- Button disabled with title: `Can't use this ride — no power data`

**Output:** Ride shown as ineligible with "no power data" reason, both in tag and button title. ✓

### Step 5: Live Strava verification

**Status:** Not performed. This task requires live Strava credentials (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `BASE_URL`) and a real linked account with recent rides. These are not available in this environment. 

As instructed in the brief: "You almost certainly do not have [these]. Say so plainly. Do NOT claim you ran the app, opened the picker, clicked a ride, or observed UI behaviour if you did not."

I did not run the app, open the picker, or observe any UI behavior. The changes are verified by inspection and hand-trace only.

## Self-review checklist

- ✓ **Strava ride names escaped:** All ride names use `${esc(rd.name)}` in lines 93 and 108
- ✓ **minMinutes used, not hardcoded 20:** Minute threshold comes from `minMinutes` parameter (lines 77, 83, 100), never hardcoded
- ✓ **Disabled button reason:** Disabled buttons display plain-English reason in title attribute (line 111): `Can't use this ride — {reason}`
- ✓ **public/actions.js untouched:** Only `public/views.js` and `public/styles.css` were modified
- ✓ **Organiser refine path wired:** Line 229 still calls `openRidePicker(r.id)` when `.refine` button is clicked; handler lookup unchanged. The key is now passed in the Strava auth link (line 222) for re-linking
- ✓ **Code style:** Compact, dense lines consistent with codebase. Comments explain why where needed (none added since logic is self-evident)

## Files changed

- `public/views.js`: Replaced `ridePickerEl` (69-117); updated `riderRow` Strava link (222), button text and title (223), calibration readout (221)
- `public/styles.css`: Added two CSS rules (135-136)

## Issues and concerns

**None.** All requirements met. The rewrite removes the stale `course` field read that was causing a crash, eliminates references to deprecated fields (`matches`, `impliedCalib`, `weightedWatts`, `avgWatts`), and presents the new interface exactly as specified in the brief.

## Fix Pass: CSS Specificity and Commit BOM

### Issue 1: CSS specificity overriding badge colors

**Problem:** The rule `.ride-tags .tg { background: #eee; color: #555; }` has specificity (0,2,0), which overrides the badge modifiers `.tg-com` and `.tg-pow` at (0,1,0), causing commute and power meter tags to render in muted grey instead of their intended colors.

**Fix:**
1. Added new rule `.tg-reason { background: #eee; color: #555; }` with specificity (0,1,0) after line 132 in `public/styles.css`
2. Removed the overly specific `.ride-tags .tg` rule from line 136
3. Updated the reason tag in ridePickerEl line 110 to use `class="tg tg-reason"` instead of `class="tg"`

**Specificity verification:**
- `.tg-com` (0,1,0): wins for commute badges ✓
- `.tg-pow` (0,1,0): wins for power meter badges ✓
- `.tg-reason` (0,1,0): wins for reason badges ✓

All three tag types now have equal specificity and render their intended colors without conflict.

**Verification:**
```bash
node --check public/views.js
npm test
```
Result: Syntax check passed, all 57 tests pass. ✓

### Issue 2: Byte-order mark in commit message

**Problem:** Original commit `6e6d5ca` had a byte-order mark (U+FEFF) at the start of the subject, showing as `﻿feat:` in git log output.

**Fix:** Amended the commit using UTF-8 without BOM:
```powershell
[System.IO.File]::WriteAllText($file, $msg, [System.Text.UTF8Encoding]::new($false))
git commit --amend -F $file
```

**Verification:**
```bash
git log -1 --format=%s | Format-Hex | Select-Object -First 2
```
Result:
```
       00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F

00000000   66 65 61 74 3A 20 72 69 64 65 20 70 69 63 6B 65  feat: ride picke
```
First byte is `66` (ASCII 'f'), not `EF` (BOM start). BOM is gone. ✓

New commit SHA: `5ebee89`

### New commit for CSS fix

Created follow-up commit `2ffc762` with message:
```
fix: use dedicated tg-reason class to preserve badge colors

Reason tags (under N min, no power data) were overriding commute and power
meter badge colors due to .ride-tags .tg selector having higher specificity.
Use .tg-reason class for reason tags instead, keeping specificity equal with
other badge modifiers.
```

## Commits

```
commit 5ebee89 (amended original)
feat: ride picker leads with one suggested effort

Show the hardest recent qualifying ride and the exact FTP it will set, with
the rest of the list behind it and plain-language reasons ("under 20 min",
"no power data") on the ones that can't be used.

commit 2ffc762 (CSS fix)
fix: use dedicated tg-reason class to preserve badge colors

Reason tags (under N min, no power data) were overriding commute and power
meter badge colors due to .ride-tags .tg selector having higher specificity.
Use .tg-reason class for reason tags instead, keeping specificity equal with
other badge modifiers.
```
