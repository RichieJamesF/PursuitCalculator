# Task 3 Report: Rework refine and rides routes to FTP-only

## Summary

Successfully rewired the `/api/riders/:id/rides` and `/api/riders/:id/refine` handlers to use FTP-only logic with the pure helper layer from Task 2. All course-distance matching and mode-switching logic has been removed. All tests pass.

## Implementation

### Step 1: Updated imports (routes/strava.js line 1-4)
Removed unused imports `paramsOf` and `engineRider` from `./helpers.js`. The file now imports exactly:
```js
import express from "express";
import { q } from "../db.js";
import { eventForRider, requireOrg, baseUrl, asyncRoute } from "./helpers.js";
import { authUrl, exchange, refresh, recentActivities, activity } from "../lib/strava.mjs";
```

### Step 2: Replaced GET /api/riders/:id/rides handler (lines 85-102)
- Changed from course-distance matching approach to FTP-eligibility sorting
- Now uses `sortRides()` to order rides by eligibility and FTP estimate
- Calls `normalizeRide()` with single argument (no course/physics parameters)
- Calls `pickSuggested()` to identify the recommended ride
- Response shape changed: removed `course` field, added `suggestedId` and `minMinutes`
- Returns: `{ rides, suggestedId: number|null, minMinutes: 20 }`

### Step 3: Replaced POST /api/riders/:id/refine handler (lines 104-133)
- Removed the `mode` request parameter handling (was: "course" vs "power")
- Removed course-distance matching logic (was matching rides within 8% of course distance)
- When no activityId provided, uses `pickSuggested()` to find the hardest recent effort
- Validates ride has power data using `rideFtpWatts()`
- Validates ride meets 20-minute minimum using `MIN_EFFORT_SECONDS`
- Response shape changed: removed `mode` field, no longer returns `calib`/`effectiveFtp`/`distanceKm`
- Returns: `{ matched: true, activity, ftp, hadPower, movingTime }` on success

### Step 4: Verification greps executed

**Grep 1: Retired concepts check**
```bash
git grep -n "impliedCalib|effectiveFtp|matchByDistance" -- lib routes tests
```
Result: No matches found ✓

**Grep 2: Mode removal verification**
```bash
git grep -n "mode" -- routes/strava.js
```
Result: No matches found ✓

## Testing Results

### Unit Tests
```
✔ 38 tests pass (including 6 new Strava ride model tests from Task 2)
- MIN_EFFORT_SECONDS is 20 minutes
- rideFtpWatts prefers weighted power from real meter
- normalizeRide marks long rides with power as eligible
- pickSuggested returns highest-power eligible non-commute ride
- sortRides puts eligible non-commutes first by power
```

### Integration Tests
```
✔ 16 tests pass
- events routes (7 tests)
- groups routes (3 tests)
- riders routes (5 tests)
- health endpoint (1 test)
```

### Full suite
```
npm run test:all: PASS (all 54 tests pass)
```

## Files Changed

**Modified:**
- `routes/strava.js` (19 insertions, 27 deletions)
  - Removed `paramsOf` and `engineRider` from imports
  - Replaced GET handler for `/api/riders/:id/rides`
  - Replaced POST handler for `/api/riders/:id/refine`
  - Helper functions (MIN_EFFORT_SECONDS, isRide, rideFtpWatts, normalizeRide, pickSuggested, sortRides) retained from Task 2

## Self-Review Findings

### Code Quality
1. ✓ Imports are exactly as specified in the brief
2. ✓ Both handlers follow the brief's code verbatim
3. ✓ No unused code left behind
4. ✓ Consistent with existing codebase style (compact, dense lines)
5. ✓ Comments explain _why_, not _what_

### Correctness
1. ✓ GET handler uses correct helper chain: filter → map(normalizeRide) → sortRides → pickSuggested
2. ✓ POST handler correctly handles both activityId and auto-suggest paths
3. ✓ All error messages use calculated `MIN_EFFORT_SECONDS / 60` (20 minutes)
4. ✓ FTP extraction and validation use Task 2's `rideFtpWatts()` helper
5. ✓ No course-distance logic remaining
6. ✓ No mode switching logic remaining
7. ✓ Auth checks remain as `requireOrg` (Task 6 will handle rider-or-organiser)

### Test Coverage
1. ✓ All existing unit tests pass (38/38)
2. ✓ All existing integration tests pass (16/16)
3. ✓ No test failures introduced

### Expected Breaking Changes (Planned)
- Browser's refine flow will be broken from this commit until Task 10
- `public/actions.js` stores `course: r.course` which this handler no longer returns
- `public/views.js` reads `rd.matches`/`rd.impliedCalib` which this handler no longer returns
- This is expected and documented in the plan; Task 9 replaces the whole UI

## Commit Details

**SHA:** 465d1ac  
**Message:** `feat: refine reads FTP from power only, with a 20-minute guard`

Full commit message (as specified in brief):
```
feat: refine reads FTP from power only, with a 20-minute guard

Drop the course-distance matching and the mode switch. Refine with no
activityId now applies the suggested hardest recent effort, and any ride
under 20 minutes or without power is rejected with a plain-language reason.
```

## Issues and Concerns

None. The implementation is complete, tested, and ready for the next task.

## Next Steps

Task 4: Mint rider_token at sign-up (no dependencies on this task's changes)
