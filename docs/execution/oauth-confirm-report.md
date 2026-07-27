# OAuth confirm/act split — closing the second CSRF route (ADR-0003 follow-up)

## What changed

### `routes/strava.js`
- Extracted `checkStravaAuth(params, res)`: the shared missing→400 / unknown-rider-or-code-mismatch→404 /
  bad-key→403 / Strava-not-configured→500 chain, unchanged in order, now called from both handlers instead
  of being duplicated.
- `GET /auth/strava` no longer redirects to Strava. After `checkStravaAuth` passes it mints the nonce, sets
  the same cookie as before (`httpOnly`, `sameSite: "lax"`, path-scoped, `maxAge`, conditional `secure`), and
  renders `confirmPage(...)` — a small server-rendered HTML page naming the rider and event in visible text,
  with a form (hidden `code`/`rider`/`key`/`nonce` fields) that POSTs to `/auth/strava`, a submit button, and
  a cancel link to `/?code=<code>`.
- Added `escHtml()`, a tiny local escape helper (not an import from `public/format.js`, which is browser
  code) used on both the visible rider/event text and the attribute values of the hidden fields.
- `POST /auth/strava` re-runs `checkStravaAuth(req.body, res)` (does not trust the GET ran), then does a
  double-submit compare: form `nonce` vs the cookie nonce via the existing `safeEqual` (same timing-safe,
  length-guarded comparison the callback already uses). Mismatch or either side absent → 403. On success it
  signs `state` with that same nonce and redirects to Strava exactly as the old GET used to.
- Callback: the two refusal paths that returned before clearing the cookie (`error` from Strava, and
  invalid/expired `state`) now go through the existing `refuse()` helper, so the cookie is cleared on every
  refusal path, matching what README already claimed.

### `server.js`
- Added `app.use(express.urlencoded({ extended: false }))` after `express.json()` — the confirmation form
  POSTs `application/x-www-form-urlencoded`, which `express.json()` alone leaves unparsed. No new
  dependency; ships with Express.

### `public/views.js`
- Not changed. Both Strava links are plain `<a href="/auth/strava?...">` browser navigations (organiser's
  rider list, rider's own page) — they still work unmodified, they just now land on the confirmation page
  first. Reviewed the surrounding copy ("Link Strava" / "Re-link Strava", the hint text) and found nothing
  that promises immediate/one-click linking that the extra confirm step would falsify.

### `README.md`
- Updated the API table (`GET` now documented as the confirm page, added the `POST` line) and rewrote the
  "Strava linking is bound to..." paragraph in "Honest status" to describe the confirm/act split and why
  cookie-binding alone didn't close the hole, matching the ADR amendment's follow-up section.

### Tests

`tests/unit/helpers.test.mjs` — added the two missing `readCookie` cases (item 4a):
- duplicated cookie name returns the first occurrence
- present-but-empty cookie value returns `""`

`tests/integration/strava.test.mjs`:
- Rewrote the old "GET verifies the signed state" test (which assumed GET redirects) into a test that the
  confirmation page renders 200 with the rider/event name, the hidden fields, and the cancel link.
- Added an escaping test: a rider named `<script>alert("hi")</script>` produces `&lt;script&gt;` in the
  page and never a literal `<script>alert`.
- Updated the Set-Cookie attribute test: status 200 (not 302), added `Max-Age=900` and asserted `Secure` is
  **absent** under the plain-HTTP test server (item 4b).
- Added a second cookie test that sets `BASE_URL=https://...` and asserts `Secure` **is** present — proving
  the conditional actually flips both ways, not just checking one branch.
- **Item 2 fix**: added a stubbed successful `fetch` for `/oauth/token` (same pattern as the existing
  "already linked" test) to both the "wrong cookie" and "no-nonce-state" tests, so a deleted nonce check
  would actually let a token write through instead of the test passing vacuously because the unstubbed path
  fails at the real Strava call.
- **Item 3**: added a full happy-path test — GET confirm page, extract nonce from the form and from
  `Set-Cookie`, POST both, decode the signed `state` from the POST's `Location`, hit the callback with that
  state + cookie + a stubbed successful token exchange, assert `stravalinked=1` and the DB row's
  `strava_access_token` is the stubbed value. Added a second copy of the same walk using the organiser's key
  instead of the rider's, since that's the other legitimate caller of this route.
- Added three more POST-specific tests: double-submit mismatch → 403, missing cookie → 403, and bad key →
  403 (proving the POST re-runs `checkStravaAuth`, not just the nonce check).

## Real mutation-check output (item 2) — actually run, not claimed

I commented out the nonce-comparison line in `routes/strava.js`:

```js
if (!cookieNonce) return refuse("nocookie");
// MUTATION-CHECK-TEMP-DELETE: if (!payload.nonce || !safeEqual(cookieNonce, payload.nonce)) return refuse("1");
```

To run only `strava.test.mjs` against the real embedded Postgres (the runner script globs all integration
files), I temporarily pointed `scripts/test-integration.mjs`'s `node --test` arg at
`tests/integration/strava.test.mjs` only, ran it, then reverted that script line back to the glob
afterward (confirmed via `git diff --stat scripts/test-integration.mjs` showing no diff once done).

**Before fix removed (BROKEN — nonce check deleted):**
```
  ✖ callback with a valid signed state and a wrong cookie value is refused with the generic error and writes no token (70.0679ms)
  ✖ callback with an old-format state carrying no nonce at all is refused, even with a cookie present (117.6346ms)
ℹ tests 26
ℹ pass 24
ℹ fail 2
```
Exactly the two targeted tests failed; nothing else in the file broke.

**After restoring the nonce check:**
```
  ✔ callback with a valid signed state and a wrong cookie value is refused with the generic error and writes no token (163.7282ms)
  ✔ callback with an old-format state carrying no nonce at all is refused, even with a cookie present (275.316ms)
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

This is a genuine before/after: I edited the file, ran the tests, read the actual `node --test` output
above, then edited the file back and ran again.

## Full test suite output (after restoring everything, `npm run test:all`)

```
ℹ tests 71
ℹ pass 71
ℹ fail 0
...
ℹ tests 54
ℹ pass 54
ℹ fail 0
```

71 unit tests (baseline 69 + the 2 new `readCookie` cases) and 54 integration tests (baseline 47 + 7 new:
confirm-page-escaping test, Secure-when-HTTPS test, rider happy-path, organiser happy-path, POST-mismatch,
POST-no-cookie, POST-bad-key), all green. `git diff --stat` confirms `scripts/test-integration.mjs` carries
no net change.

## Self-review

**Can any request still reach the Strava redirect without passing through the confirmation POST?**
No. `authUrl()` (the only thing that produces a redirect to `strava.com`) is called from exactly one place
in `routes/strava.js`: inside the `POST /auth/strava` handler, after the double-submit check passes. The
GET handler renders `confirmPage(...)` and returns; it never calls `authUrl` or `res.redirect` to Strava.
Grepped the file to confirm `authUrl(` has a single call site.

**Can an attacker's page auto-POST to `/auth/strava` and skip the confirmation? Trace both defences.**
Two independent things have to both be beaten:
1. `SameSite=Lax` — the nonce cookie is set on a top-level GET navigation (the confirmation page). A
   cross-site auto-POST from an attacker's page is not a top-level navigation with a "safe" method, so
   under `Lax` the browser does not attach the cookie to that request. `checkStravaAuth` may still pass
   (the attacker supplies a valid code/rider/key combo for their own rider — that part was never secret),
   but with no cookie header at all `cookieNonce` is `null` and the double-submit check 403s regardless.
2. Double-submit itself — even setting `SameSite` aside, the attacker's forged page has no way to *know*
   the nonce value to embed as the form's `nonce` field, because that value is randomly minted per real GET
   request and only ever delivered to the browser that made that GET (in the HTML body and the cookie). An
   attacker who never saw the confirmation page cannot guess a 32-hex-char random value.
   Verified via the new "rejects a mismatched double-submit nonce" and "rejects a missing nonce cookie"
   integration tests — both 403, both run against the real server.

**Does the confirmation page escape rider and event names in both text and attribute contexts?**
Yes — `escHtml()` is applied to `riderName`/`eventName` for the visible `<strong>` text, and separately to
`code`/`rider`/`key`/`nonce` for the hidden-field `value="..."` attributes. Verified for real (not just by
reading the code) with the "escapes a rider name with HTML-significant characters" integration test: a
rider named `<script>alert("hi")</script>` produces `&lt;script&gt;` in the served HTML and the literal
string `<script>alert` does not appear anywhere in the response body.

**Does the legitimate flow still work end to end for a rider and for an organiser?**
Yes for both, and both are proven by an actual round-trip test rather than inference from shared code:
"full flow: confirm page, POST with matching nonce, callback writes the token and redirects with
stravalinked=1" (rider's own key) and "full flow with an organiser key: confirm page, POST, callback writes
the token" (organiser token as `key`). Both walk GET confirm → extract nonce from form + cookie → POST →
decode the real signed state from the redirect → hit the callback with a stubbed *successful* token
exchange → assert `stravalinked=1` in the redirect and the actual `strava_access_token` column value in
Postgres.

## What I could not verify

- No live browser was driven and no dev server was booted interactively — all evidence above is from
  `node --test` against the embedded Postgres instance via `fetch`, per the environment notes. I cannot
  personally confirm what the confirmation page looks like rendered in an actual browser (fonts, button
  styling, mobile layout) — only that the HTML it emits contains the expected structural elements and
  escapes correctly.
- I did not test against the real strava.com OAuth endpoints (token exchange, athlete activities) — all
  Strava-side interaction in the new/fixed tests uses a stubbed `globalThis.fetch`, same as the pre-existing
  "already linked" test. The live round-trip remains the thing the README already says has to be verified
  by hand with real `STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET`.
- I did not independently re-verify every pre-existing passing test in the full suite line-by-line beyond
  confirming the aggregate pass counts (71/71 unit, 54/54 integration) shown above.
