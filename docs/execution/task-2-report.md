# Task 2 Report: Rebuild the Strava ride model around FTP-from-power

## What I Implemented

Rebuilt the Strava ride model to derive FTP estimates from power data instead of course distance. The implementation includes:

1. **`MIN_EFFORT_SECONDS`** — Constant set to 1200 (20 minutes), the minimum ride duration for power to count as a reliable FTP estimate.

2. **`rideFtpWatts(activity)`** — Helper that extracts FTP in watts:
   - Prefers weighted average power from a real power meter
   - Falls back to average watts if no weighted value exists
   - Falls back to average watts for riders without a power meter
   - Returns `null` when no power data is available
   - Always rounds the result to the nearest integer

3. **`normalizeRide(activity)`** — Single-argument function (taking only the activity, not the five arguments the old version took) that normalizes a Strava activity to a consistent structure with:
   - Basic fields: `id`, `name`, `date` (from `start_date`)
   - Computed fields: `distanceKm`, `movingTime`, `avgSpeedKmh` (converted from m/s)
   - Power analysis: `ftpEstimate` (from `rideFtpWatts`), `hasPower` (device_watts flag)
   - Eligibility flags: `commute`, `longEnough` (>= 1200 seconds), `eligible` (power present AND long enough)

4. **`pickSuggested(normalizedRides)`** — Selects the single best ride for FTP refinement:
   - Filters to eligible, non-commute rides only
   - Returns the ride with the highest `ftpEstimate`
   - Returns `null` if no rides qualify

5. **`sortRides(normalizedRides)`** — Sorts rides for display:
   - Rank 0: eligible, non-commute rides (sorted by power descending)
   - Rank 1: all other rides (sorted by date descending)
   - Returns a new array; input is never mutated

## TDD Evidence

### Step 2: Tests Fail (RED)
```
Command: npm test

SyntaxError: The requested module '../../routes/strava.js' does not provide an export named 'MIN_EFFORT_SECONDS'
    at #asyncInstantiate (node:internal/modules/esm/module_job:327:21)
```

Expected failure: The functions didn't exist yet, so the test file couldn't import them.

### Step 4: Tests Pass (GREEN)
```
Command: npm test

✔ MIN_EFFORT_SECONDS is 20 minutes
✔ rideFtpWatts prefers weighted power from a real power meter
✔ rideFtpWatts falls back to average watts when there is no power meter
✔ rideFtpWatts falls back to average watts when a meter ride has no weighted value
✔ rideFtpWatts returns null when there is no power at all
✔ normalizeRide marks a long ride with power as eligible
✔ normalizeRide marks a ride under 20 minutes as too short and ineligible
✔ normalizeRide marks a powerless ride ineligible but keeps it listed
✔ pickSuggested returns the highest-power eligible non-commute ride
✔ pickSuggested ignores commutes and short rides
✔ pickSuggested returns null when nothing qualifies
✔ sortRides puts eligible non-commutes first by power, then the rest by date, without mutating the input

Total: 38 tests pass (12 new + 26 existing), 0 fail
```

### Step 5: Full Test Suite
```
Command: npm run test:all

Unit tests: 38 pass, 0 fail
Integration tests: 16 pass, 0 fail
Total: 54 pass, 0 fail
```

All tests pass including the integration suite against a real embedded Postgres database.

## Files Changed

- **`routes/strava.js`** — Replaced lines 43-56 (old RIDE_TYPES/isRide/normalizeRide block) with new exports:
  - Added `MIN_EFFORT_SECONDS` constant
  - Converted `isRide` to a named export (unchanged logic)
  - Added `rideFtpWatts()` helper
  - Rewrote `normalizeRide()` to take single argument and return new structure
  - Added `pickSuggested()` function
  - Added `sortRides()` function

- **`tests/unit/strava.test.mjs`** — Created new test file with 12 tests covering all five exported functions and the constant

## Commit

- **Hash**: `a5e5f4c`
- **Message**: 
  ```
  feat: model Strava rides by FTP eligibility, not course distance

  Every ride now carries a power-derived FTP estimate and an eligible flag
  (power present, 20 minutes or longer). pickSuggested picks the hardest
  recent effort and is shared with the auto-refine so the ride a rider is
  shown is always the ride that gets applied.
  ```

## Self-Review Findings

1. **Brief compliance**: All required functions and constants implemented exactly as specified. The interface matches Task 10's UI assertions and Task 3's routing refactor.

2. **Test coverage**: 12 new tests cover:
   - All branches of `rideFtpWatts` (weighted, average, fallback, null)
   - `normalizeRide` output shape and eligibility logic (long enough, power present, eligible)
   - `pickSuggested` selection (highest power, filtering commutes/short rides, null when nothing qualifies)
   - `sortRides` ordering and immutability contract

3. **Code style**: Maintained existing compact, dense style with explanatory comments on the "why" (e.g., why 20 minutes, why weighted power matters).

4. **Backward compatibility**: The old `normalizeRide` took five arguments. The new version takes one. The existing call site in the routes handler (`/api/riders/:id/rides`, line 73) still passes five arguments, but JavaScript silently ignores the extras. This is intentional per the brief — Task 3 will fix the call site. Verified that passing extra args causes no errors and integration tests pass.

5. **Constants**: `MIN_EFFORT_SECONDS` is defined once as a named export, never re-hardcoded. The 6-week freshness window (42 * 864e5 ms) remains in the route handlers as specified.

6. **No new dependencies**: All code uses only standard JavaScript, Node built-ins (`Math.round`, `Date`), and existing Strava API structures.

## Issues and Concerns

None. All requirements met, all tests pass (54 total), code is clean and follows the specified style.
