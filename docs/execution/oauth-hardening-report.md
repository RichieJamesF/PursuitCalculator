# OAuth hardening — four narrow fixes

Branch: `rider-self-service-ftp-refinement`. Scope was strictly the four items below —
**no attempt was made to close the underlying rider-hijack**, which remains open per
ADR-0003's "Correction: the confirmation page does not close it either" section
(read before starting; left untouched except for the controller's own uncommitted edits,
which are included in this commit as instructed).

## 1. Confirmation page copy — `routes/strava.js`, `confirmPage`

Replaced the identity question ("Only continue if that's you") with a provenance question,
which an attacker cloning the victim's rider name cannot spoof:

```
This will link a Strava account to <strong>{rider}</strong> in <strong>{event}</strong>.
Only continue if you tapped "Link Strava" on your own rider page just now. If you got here
from a link someone sent you, stop and close this page.
```

Rider/event escaping (`escHtml`), the form, hidden fields, and the cancel link are byte-for-byte
unchanged — only the `<p>` copy changed (split into two paragraphs).

## 2. `X-Frame-Options: DENY` — `server.js`, `createApp()`

Added to the same middleware that already sets `Referrer-Policy: no-referrer`, so it applies
app-wide:

```js
app.use((_req, res, next) => { res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Frame-Options", "DENY"); next(); });
```

## 3. `Cache-Control: no-store` on the confirmation page — `routes/strava.js`, GET `/auth/strava`

Added `res.setHeader("Cache-Control", "no-store")` right before `res.type("html").send(confirmPage(...))`,
after the nonce cookie is set. This is scoped to that one response — the static-file
middleware's `no-cache` for `.html/.js/.mjs/.css` in `server.js` is untouched, and no other
router response gets this header.

## 4. Test fix — `tests/integration/strava.test.mjs`

"POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403)" previously sent
no `Cookie` header, so it always 403'd at the nonce check regardless of whether `checkStravaAuth`
ran — asserting only `res.status === 403`.

Fixed to send a matching cookie/form nonce pair (so the nonce check alone would let the
request through to a 302, not a 403) and a bad key, then assert the **body text**:

```js
test("POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403)", async () => {
  const { rider } = await seed(ctx.baseUrl, "sv-postbadkey");
  const cookieNonce = "matching-nonce-for-badkey-test";
  const res = await fetch(`${ctx.baseUrl}/auth/strava`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `pursuit_oauth_nonce=${cookieNonce}` },
    body: new URLSearchParams({ code: "sv-postbadkey", rider: String(rider.id), key: "nope", nonce: cookieNonce }).toString(),
  });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /That key doesn't grant access to this rider\./);
});
```

### Real before/after mutation verification (actually run, not asserted)

Temporarily edited `routes/strava.js`'s POST handler to remove the `checkStravaAuth` call:

```js
router.post("/auth/strava", asyncRoute(async (req, res) => {
  // TEMP-MUTATION-FOR-VERIFICATION: checkStravaAuth call removed to prove the new test catches it.
  const auth = { code: req.body?.code, rider: req.body?.rider };
  if (!auth) return;
  const { code, rider } = auth;
  ...
```

Ran `tests/integration/strava.test.mjs` alone against a fresh embedded-postgres instance
(via a throwaway `scripts/_verify-strava-only.mjs`, deleted afterward — not part of the diff).

**Before restore (mutated — checkStravaAuth removed) — test FAILS as expected:**

```
✔ POST /auth/strava rejects a mismatched double-submit nonce (form vs cookie) and never redirects to Strava (519.9321ms)
✔ POST /auth/strava rejects a missing nonce cookie even with a matching form nonce (350.5608ms)
Error: STRAVA_CLIENT_SECRET is required to sign state
    at signState (file:///C:/Users/Rich/PursuitCalculator/lib/strava.mjs:17:24)
    at file:///C:/Users/Rich/PursuitCalculator/routes/strava.js:99:17
    ...
  ✖ POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403) (621.9469ms)
✔ full flow with an organiser key: confirm page, POST, callback writes the token (276.0518ms)
✖ strava routes (9225.5546ms)
ℹ tests 27
ℹ pass 26
ℹ fail 1

✖ failing tests:
test at tests\integration\strava.test.mjs:447:3
✖ POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403) (621.9469ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  500 !== 403
      at TestContext.<anonymous> (file:///C:/Users/Rich/PursuitCalculator/tests/integration/strava.test.mjs:458:12)
```

(With the matching cookie/nonce and `checkStravaAuth` gone, the bad-key request sailed
through the nonce check and reached `signState()`, which threw because this particular
test doesn't set `STRAVA_CLIENT_SECRET` — producing a 500, not the 403 the test expects.
Either way, the test now visibly reacts to the auth check being removed, which is the point.)

Restored `checkStravaAuth`, re-ran the same isolated file:

**After restore — test PASSES, along with the rest of the file:**

```
✔ POST /auth/strava re-runs the same auth checks as the GET (bad key -> 403) (434.1723ms)
✔ full flow with an organiser key: confirm page, POST, callback writes the token (171.1289ms)
✔ strava routes (8813.4626ms)
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

## Full test output (all suites, final state)

Unit (`npm test`):

```
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Integration (`npm run test:integration`):

```
▶ events routes (6 tests) ✔
▶ groups routes (3 tests) ✔
▶ health (1 test) ✔
▶ riders routes (16 tests) ✔
▶ strava routes (27 tests) ✔ — including the fixed test
ℹ tests 54
ℹ suites 4
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Matches the stated baseline of 71 unit + 54 integration passing. The embedded-postgres
shutdown noise ("duplicate key value violates unique constraint", checkpointer exit code 1,
the Node `DEP0190` deprecation warning) appears in every run of this suite, before and after
these changes — it is the shared-instance teardown/parallel-run artifact already commented on
in `scripts/test-integration.mjs`, not a test failure (`pass 54 / fail 0` in the same run).

## What could not be verified

Nothing in the four items was left unverified. The one thing worth flagging as a suggestion
(not implemented, per the constraint against further hijack fixes): the mutation test above
only reached a 500 rather than the "expected" 403 path because `signState()` throws before
producing a response when Strava env vars are absent — a defensive `try/catch` around
`signState` in the POST handler isn't there today and isn't part of this task, but a reviewer
may want to know the 403 in the *unmutated* code path is reached before `signState` is ever
called, which is why the real (non-mutated) test's 403 is genuine and not incidental.

## Files touched

- `C:\Users\Rich\PursuitCalculator\routes\strava.js`
- `C:\Users\Rich\PursuitCalculator\server.js`
- `C:\Users\Rich\PursuitCalculator\tests\integration\strava.test.mjs`
- `C:\Users\Rich\PursuitCalculator\docs\adr\0003-rider-self-service-via-rider-key.md` (controller's pre-existing uncommitted edit, included per instructions, not authored by this work)
