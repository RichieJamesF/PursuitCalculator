# OAuth CSRF fix: bind the Strava consent flow to the initiating browser

## What changed

**`routes/helpers.js`** — added `readCookie(header, name)`, a small parser for pulling one
named cookie out of a raw `Cookie` header. Splits on `;`, then for each segment splits only on
the *first* `=` (so a value containing `=` survives), trims whitespace off both name and value,
and compares the name with strict `===` (not `.includes`/unanchored substring), so a cookie whose
name is a prefix or suffix of the target (`pursuit_oauth_nonce_v2`, `old_pursuit_oauth_nonce`)
can't false-match.

**`lib/strava.mjs`** — exported the existing `STATE_EXPIRY_MINUTES` constant (was
module-private) so the cookie's `maxAge` in `routes/strava.js` can be derived from the same
number the state's own expiry check uses, instead of a second hardcoded "15 minutes" that could
drift out of sync.

**`routes/strava.js`**:
- `GET /auth/strava`: after the existing key/config checks pass, generates
  `crypto.randomBytes(16).toString("hex")`, folds it into the signed state as `nonce`, and sets
  it as a cookie named `pursuit_oauth_nonce` with `httpOnly: true, sameSite: "lax", path:
  "/auth/strava", maxAge: 15 minutes, secure: baseUrl(req).startsWith("https:")`.
- `GET /auth/strava/callback`: after `verifyState` succeeds and strictly before `exchange(authCode)`,
  reads the cookie via `readCookie(req.headers.cookie, NONCE_COOKIE)` and compares it against
  `payload.nonce` with a length-guarded `crypto.timingSafeEqual` (`safeEqual` helper — converts
  both sides to `Buffer`, checks `.length` equality before calling `timingSafeEqual`, which
  throws on a length mismatch rather than returning false).
  - Cookie absent entirely → `res.clearCookie(...)`, redirect to `/?stravaerror=nocookie`.
  - Cookie present but `payload.nonce` missing (old-format state) or mismatched → clear cookie,
    redirect to the existing generic `/?stravaerror=1` — deliberately the *same* signal as a
    tampered/expired state, so a genuine attack attempt gets no information about which check
    failed.
  - Match → clear the cookie (same `path`) and proceed exactly as before (token exchange, dupe
    check, token write, success redirect).

**`public/state.js`** — the banner logic now special-cases `stravaerror=nocookie` with "Strava
linking needs cookies enabled in your browser — turn them on and try again," ahead of the
generic "Strava linking failed." message, so a rider who blocked cookies isn't left guessing.

**`README.md`** — replaced the "Known open issue: Strava linking can be redirected to the wrong
rider" paragraph (which documented this exact hole as open) with a description of the fix, and
extended the integration-test summary line to mention the three new nonce-binding cases.

**`docs/adr/0003-rider-self-service-via-rider-key.md`** — already carried the amendment
authorising this cookie before I started (dated 2026-07-27, in the working tree, uncommitted);
I did not write it, only implemented what it specifies, and committed it alongside this change.

## Tests added

`tests/unit/helpers.test.mjs` — 8 new cases for `readCookie`: header absent (`undefined`,
`null`, `""`), single cookie, several cookies, whitespace around name/value, a value containing
`=`, a name that's a prefix of the target, a name that's a suffix of the target, and "not
present at all."

`tests/unit/strava-state.test.mjs` — 1 new case: `signState`/`verifyState` round-trip a `nonce`
field intact.

`tests/integration/strava.test.mjs` — 4 new cases:
- `GET /auth/strava` sets the nonce cookie with `HttpOnly`, `SameSite=Lax`, and
  `Path=/auth/strava` (asserted directly on the `Set-Cookie` header).
- Callback with a valid signed state but **no cookie** → 302 to `stravaerror=nocookie`, and the
  rider's `strava_access_token` is confirmed still `null` via a direct DB query.
- Callback with a valid signed state and a **wrong** cookie value → 302 to `stravaerror=1` (and
  asserted *not* `nocookie`), token column still `null`.
- Callback with an **old-format state carrying no `nonce`** (built via `signState` without that
  field), cookie present → refused.

I also had to adjust one pre-existing test ("callback refuses a Strava athlete already linked to
a different rider...") to carry a matching nonce/cookie pair — before this change its state had
no nonce and no cookie was sent, which is now a legitimate refusal path that would have short
-circuited before ever reaching the dupe-detection logic the test exists to check. Fixed by
adding `nonce: "matching-nonce"` to the `signState` call and a `Cookie: pursuit_oauth_nonce=matching-nonce`
header on the request.

## Test output (real runs, this session)

`npm test` (unit): **69 pass, 0 fail** (baseline 60 + 9 new: 8 `readCookie` + 1 nonce round-trip).

`npm run test:integration`: **47 pass, 0 fail** (baseline 43 + 4 new).

`npm run test:all` run afterward to confirm both together: same totals, same result — 69 unit +
47 integration, all green. Full raw output was captured in the terminal during the session; the
tail of the integration run reproduced below (identical pass/fail counts across all three runs):

```
ℹ tests 69
ℹ pass 69
ℹ fail 0
...
▶ strava routes
  ✔ GET /auth/strava sets the nonce cookie with HttpOnly, SameSite=Lax and the expected path
  ✔ callback with a valid signed state but no cookie is refused, signals the no-cookie case, and writes no token
  ✔ callback with a valid signed state and a wrong cookie value is refused with the generic error and writes no token
  ✔ callback with an old-format state carrying no nonce at all is refused, even with a cookie present
  ✔ callback refuses a Strava athlete already linked to a different rider in the same event
✔ strava routes
ℹ tests 47
ℹ pass 47
ℹ fail 0
```

One piece of log noise appeared during DB shutdown in every run (before and after my change):
`ERROR: duplicate key value violates unique constraint "events_code_key" ... Key (code)=(dupe-test)`.
This is emitted by the embedded Postgres process during its own shutdown/checkpoint sequence,
not by any test in this suite (there is no `dupe-test` event code anywhere in
`tests/integration/*.test.mjs` — the closest is `sv-dupe`, unrelated). It appears after "tests
47 / pass 47" in the log and does not affect the reported pass count. I did not investigate its
root cause further since it's pre-existing behavior unrelated to this change and the harness
still reports a clean pass.

## Self-review

**Can a refused flow ever reach `exchange()`?** No. Traced the callback handler top to bottom:
`error` query param check → `verifyState` → cookie-absent check → `payload.nonce`/mismatch check
— all three `return` before the `await exchange(authCode)` line. There is no code path between
a `refuse(...)` call and `exchange()`; `refuse` itself calls `res.redirect` (which doesn't
return control to continue the function) and the callers all `return refuse(...)`.

**Does the legitimate flow still work end to end on a fresh browser with no prior cookie?**
I can't drive a real browser (no `DATABASE_URL` outside the test harness, no Strava
credentials), but the integration test suite exercises exactly this shape end-to-end against a
real embedded Postgres and a stubbed Strava token endpoint: `GET /auth/strava` sets the cookie,
and the pre-existing "callback refuses a Strava athlete already linked..." test (now carrying a
matching nonce/cookie pair) proves the full round-trip — state signed, cookie sent, nonce
matches, `exchange()` runs, token would be written — reaches all the way through to the
dupe-check logic past the token exchange. That is as much verification as I can honestly claim;
I did not open a browser.

**Is `secure` genuinely conditional, and would the cookie survive a local HTTP dev session?**
Yes — `secure: baseUrl(req).startsWith("https:")`. `baseUrl(req)` (from `routes/helpers.js`) is
`process.env.BASE_URL || `${req.protocol}://${req.get("host")}``; in local HTTP dev with no
`BASE_URL` set, `req.protocol` is `"http"`, so `secure` evaluates `false` and the cookie is set
without the `Secure` attribute — browsers will store and return it over plain HTTP. On Railway,
`BASE_URL` (or a proxy-forwarded `https` protocol) makes `baseUrl(req)` start with `https:`, so
`secure` is `true` there. I did not run this against an actual Railway deployment or a real
browser; this is read from the code path plus the existing `baseUrl` unit/integration coverage,
not a live-observed fact.

**Does the cookie's `path` cover both `/auth/strava` and `/auth/strava/callback`?** Yes, by the
cookie-path-matching rule (RFC 6265 §5.1.4): a cookie's `Path=/auth/strava` matches a request
path if that path is a prefix of the request path *and* either the cookie path ends in `/` or
the next character in the request path is `/`. `/auth/strava/callback` has `/` immediately after
`/auth/strava`, so it matches. This is standard browser behavior, not something this app
computes — I did not write or need a special case for it.

**Does the cookie parser mis-handle a cookie named as a prefix/suffix of mine?** No — verified
by two dedicated unit tests (`pursuit_oauth_nonce_v2=wrong; pursuit_oauth_nonce=right` and
`old_pursuit_oauth_nonce=wrong; pursuit_oauth_nonce=right`, both asserting `readCookie` returns
`"right"`). The reason it's safe: `readCookie` compares the trimmed name with strict `===`
against the full segment before the first `=`, not a substring/`.includes` check against the
whole header — so a longer or differently-prefixed name can never satisfy the equality test.

## What I could not verify

- No live browser exercised the flow (no dev server reachable outside the test harness, no
  Strava OAuth credentials available to this session). Everything above is either static
  reasoning from the code and RFC 6265 cookie-path semantics, or backed by the integration tests
  that do run against a real embedded Postgres with a stubbed Strava token endpoint.
- I did not deploy to or inspect Railway; the `secure` conditional's proxy behavior is asserted
  from reading `baseUrl(req)`'s definition, not observed against a live Railway request.
