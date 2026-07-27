# Task 4: Mint a rider key at sign-up - Report

## Summary

Successfully implemented rider key minting at sign-up. Each rider now gets their own cryptographically random token, returned once in the sign-up response, and never exposed in the public event payload.

## What was implemented

### 1. Database schema (schema.sql)
- Added `ALTER TABLE riders ADD COLUMN IF NOT EXISTS rider_token TEXT;` with idempotent syntax
- Positioned after the table definition and before the index, as specified
- Includes comment explaining the purpose (ADR-0003) and handling of pre-shipped rows (null)

### 2. Sign-up handler (routes/riders.js)
- Added `token` to the imports from helpers.js
- Modified POST /api/events/:code/riders to:
  - Mint a rider key using `token()` (crypto.randomBytes(16).toString("hex"))
  - Include `rider_token` in the INSERT statement
  - Return the key in the sign-up response as `riderKey`
  - Preserve existing `publicRider()` transformation (which deliberately excludes the token)

### 3. Integration tests (tests/integration/riders.test.mjs)
- Added test: "POST /api/events/:code/riders returns a rider key once, and never leaks it again"
  - Verifies signup response contains a valid 32-character hex string
  - Verifies the token does NOT appear as `riderKey` in public event listing
  - Verifies the token does NOT appear as `rider_token` in public event listing
- Added test: "two riders in the same event get different rider keys"
  - Verifies each rider gets a unique key

## TDD Evidence

### RED (failing tests)
```
npm run test:integration
```
Initial run showed 2 failing tests:
- `POST /api/events/:code/riders returns a rider key once, and never leaks it again`
  - Error: "AssertionError ... The 'string' argument must be of type string. Received type undefined"
  - `signup.riderKey` was undefined
- `two riders in the same event get different rider keys`
  - Error: AssertionError, `riderKey` was undefined

This confirmed the tests were properly checking for the missing feature.

### GREEN (passing tests)
```
npm run test:integration
```
After implementation:
- All 18 integration tests pass (including the 2 new ones)
- Both new tests verify the key is minted and never leaks

### Full test suite
```
npm run test:all
```
- 38 unit tests pass
- 18 integration tests pass
- Total: 56 tests passing, 0 failing
- No regressions

## Files Changed

- `/C:/Users/Rich/PursuitCalculator/schema.sql` - Added idempotent column
- `/C:/Users/Rich/PursuitCalculator/routes/riders.js` - Minting and returning key
- `/C:/Users/Rich/PursuitCalculator/tests/integration/riders.test.mjs` - Added 2 tests

## Self-Review Findings

### No-leak verification
✓ The `rider_token` column is properly added with idempotent syntax
✓ The `publicRider()` helper deliberately excludes `rider_token` and was not modified
✓ The public event payload (via `eventPayload()`) uses `riders.map(publicRider)`, ensuring tokens never leak
✓ The integration test would genuinely fail if `rider_token` appeared in the public listing (lines 101-102)

### Implementation correctness
✓ Uses existing `token()` helper as required (crypto.randomBytes(16).toString("hex"))
✓ Returns key exactly once in signup response
✓ Each rider gets a unique key (verified by test)
✓ Follows existing code style: compact, dense lines; inline comments explain why not what

### No scope creep
✓ No auth changes (reserved for Task 5)
✓ No Strava routes touched (reserved for Task 6)
✓ No frontend changes (reserved for Task 7-8)
✓ Only the three files specified in brief were modified

### Test output pristine
✓ All tests pass cleanly
✓ No warnings or errors beyond expected deprecation notices
✓ The new tests are comprehensive and would catch any future regressions

## Commit

```
commit 1f4a386
Author: Richard Fleming <Rich@royce-lingerie.co.uk>
Date:   Sun Jul 27 14:16:54 2026 +0000

    feat: mint a rider key at sign-up (ADR-0003)
    
    Each rider now gets their own token, returned once in the sign-up response
    and never included in the public event payload.
```

## Issues or Concerns

None. The implementation is complete, tested, and ready for Task 5 (auth handler).
