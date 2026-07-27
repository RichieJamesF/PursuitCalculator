---
status: accepted
---

# Rider self-service via a rider key, mirroring the organiser key

**Context**: Riders could only be edited by the organiser — a confirmed oversight from
the app audit, not a deliberate choice. Separately, `GET /auth/strava` has no auth check
at all: it only requires an event code and a rider id (a small, guessable integer) in the
query string, so anyone who can construct that URL can trigger a Strava OAuth link for
any rider in any event. Both gaps come down to the same missing piece: the app has a
credential for the organiser and nothing for a rider.

**Decision**: Mint a `rider_token` per rider at sign-up, the same way `organiser_token`
already works — random, returned once in the sign-up response, auto-saved to localStorage
in the browser that created it (so the common case, same-device return visits, needs zero
extra action from anyone). The sign-up confirmation screen shows the rider a personal
"rider key" / edit link to copy or email to themselves for cross-device access, reusing
the exact `renderCreated`/`detailsMailto`/`copyDetails` pattern already built for the
organiser key. A new `requireRiderOrOrg` check accepts either the event's organiser token
or that specific rider's token, and gates: `PATCH`/`DELETE` on that rider's own row, and
`GET /auth/strava` + refine for that rider (closing the unauthenticated-linking gap as a
side effect). Riders get a real self-service page — view/edit their own details, link
Strava, trigger their own refine — instead of routing every one of those actions through
the organiser. A lost rider key falls back to "ask the organiser to delete and re-add
you," identical to the recovery story an organiser already has for a lost organiser key,
so this adds no new support burden beyond what already exists today.

**Consequences**:
- Schema: `riders.rider_token TEXT`, nullable — rows created before this ships have no
  self-edit access until the organiser deletes and re-adds them.
- Directly reduces organiser workload (the stated priority): riders can now link Strava
  and refine themselves rather than needing the organiser to do it one rider at a time.
- No rider email is collected. "Remembered in this browser" and "you saved your own link"
  are the only two ways a rider keeps access — the same trade-off the organiser already
  lives with for their own key.
- Rider keys travel in URLs: in the rider's own link (`/?code=…&rider=…&key=…`) so they can
  return from another device, and as a `key=` query param on `GET /auth/strava`, because a
  plain `<a href>` navigation cannot carry a custom header. Keys therefore appear in browser
  history and server access logs. Accepted: a rider key grants edit rights over exactly one
  rider row, and the app already distributes event access by shareable link. Do not
  "upgrade" this to cookies or sessions without revisiting this ADR — see the amendment
  below, which revisits it for one narrow case.
- The organiser's own Strava link (`href="/auth/strava?code=…&rider=…&key=…"` in the rider
  list) carries the *organiser* token the same way, and the "grants edit rights over exactly
  one rider row" reasoning above doesn't cover that key — it grants edit rights over the whole
  event. That link 302s cross-origin to strava.com, so under a browser (or embedded webview)
  still defaulting to `no-referrer-when-downgrade` the full URL, key included, would reach
  Strava as a referrer. Mitigated with an explicit `Referrer-Policy: no-referrer` set on every
  response in `createApp()`, rather than relying on the modern browser default.

---

## Amendment (2026-07-27): one transient cookie is permitted, to bind the OAuth flow

**Why this is being revisited.** HMAC-signing the OAuth `state` proved *the server issued
it*. It never proved *the party completing the flow is the party who requested it*, and only
the second property stops the following: an attacker signs up their own event and rider
through the public endpoints, legitimately obtains a correctly-signed `state` for their own
rider, sends a victim the resulting Strava consent link, and — when the victim approves under
the victim's own account — the callback writes the **victim's** tokens onto the **attacker's**
rider row. The attacker then reads the victim's ride history through their own rider key. The
15-minute expiry is not a mitigation, because a fresh state can be minted per target. A
server-side one-time nonce is not a mitigation either, because the state genuinely is fresh
and legitimately issued; the defect is in *which browser* finishes the journey. This is the
textbook OAuth CSRF gap, and browser binding is its textbook fix.

**Decision.** Permit exactly one cookie, for exactly this purpose. `GET /auth/strava` mints a
random nonce, embeds it in the signed `state`, and sets it as a cookie (`HttpOnly`,
`SameSite=Lax`, `Secure` when the deployment is HTTPS, path-scoped to `/auth/strava`, ~15
minute lifetime). The callback compares the cookie against the nonce in the verified state
with a timing-safe comparison, refuses on mismatch or absence, and clears the cookie. The
comparison happens *before* the token exchange, so a refused flow never contacts Strava.

**Why this does not contradict the rule above.** The rule exists to keep *identity* stateless
and link-based: a rider's access must stay a URL they can save, never a server-side session
they can lose. This cookie authenticates nobody, carries no identity, survives one OAuth
round-trip, and is deleted immediately after. Losing it costs a rider one retry, never their
access. If a future change proposes a cookie that identifies a rider or persists a session,
the original rule stands and must be revisited on its own terms.

**Consequences.**
- A rider with cookies blocked entirely cannot link Strava. The flow fails closed with a
  message naming the cause rather than a generic failure, since failing open would defeat the
  control. Everything else in the app still works without cookies.
- `SameSite=Lax` is required, not `Strict`: the callback is a top-level GET navigation from
  strava.com, and `Strict` would suppress the cookie and break the legitimate flow.
- No new dependency. Express sets cookies natively and one named cookie is read straight off
  the request header.
- Under UK/EU rules this is a strictly-necessary security cookie with no tracking, so it needs
  no consent banner.

### Follow-up: the cookie alone was not sufficient

Review of the implementation found the nonce closes only one of the two routes to the same
outcome. It stops an attacker harvesting a signed `state` and passing the *strava.com* consent
URL to a victim. It does not stop the attacker passing the victim **this app's own**
`/auth/strava?code=…&rider=…&key=…` URL instead: the victim's browser then performs both legs
itself, so it mints the nonce, holds the matching cookie, and the callback check passes
honestly — while the rider the tokens land on is still whichever one the attacker named in the
query string. Binding the flow to a browser cannot help when the browser is the victim's and
the rider is chosen by a bearer key in the URL.

The real defect is that `GET /auth/strava` performs a state-changing action, authorised solely
by a URL-borne key, with nothing shown to the person whose account is about to be linked.

**Additional decision.** `GET /auth/strava` no longer redirects to Strava. It authenticates as
before, then renders a confirmation page on this app's own origin naming the rider and the
event — "Link a Strava account to **Bex** in **Tuesday 10**?" — with a form that `POST`s back
to `/auth/strava`. Only the POST mints the state and redirects to Strava. The nonce cookie is
set when the confirmation page is rendered and its value is also embedded in the form, so the
POST is a double-submit check as well as the callback binding; `SameSite=Lax` independently
blocks a cross-site auto-POST, so an attacker cannot skip the page.

A victim sent the attacker's link now sees a rider name that is not theirs *before* anything
happens, on this app's domain, in this app's wording. That is the control that actually closes
it; the nonce remains necessary for the second leg.

**Consequences.**
- One extra click for every rider linking Strava. Judged worth it, and independently useful:
  it also catches an organiser linking the wrong rider from the rider list, and a shared
  household device.
- `/auth/strava` is now GET (confirm) + POST (act). A bookmarked or re-sent GET is harmless.
- The 2026-07-27 recommendation that the cookie alone closed this was wrong, and is corrected
  here rather than quietly amended, because the earlier text is what justified the cookie.

### Correction: the confirmation page does not close it either

Review of the confirmation step found its stated premise — "a victim sees a rider name that is
not theirs" — is false. Rider names are free text with no uniqueness constraint,
`GET /api/events/:code` is unauthenticated and lists every rider, and rider sign-up is public.
So an attacker can read the victim's exact name and event, create a second rider **in the
victim's own event with the victim's own name**, and send the link for it. The victim then
reads their real name and their real event on the correct domain, and "only continue if that's
you" is something they can truthfully answer yes to.

Tracing that further exposes the actual root cause, which is not specific to Strava at all:
**a rider key in a shareable URL is auto-adopted as that browser's identity.**
`public/state.js` stores any `?key=` it sees and treats the browser as that rider from then on.
So anyone who sends you a link can silently put your browser into another rider's session, and
every control downstream of that — the nonce cookie, the confirmation page, a POST-with-header
initiation — is a speed bump rather than a fix. Each of the three attempted fixes moved the
attack one hop earlier instead of removing it.

**Status: open, root cause identified, awaiting a decision on the credential model.** Nothing
in this ADR, the README, or the code may describe the Strava hijack as closed. What the three
commits *did* achieve is real and worth keeping: the harvested-consent-URL variant is dead
(nonce cookie), the flow is no longer a drive-by GET, an already-linked athlete cannot be
silently re-attached, and `Referrer-Policy: no-referrer` keeps keys out of referrers.

The decision to be made is about ADR-0003's central choice — a bearer credential in a
shareable URL, auto-adopted on arrival. Options are recorded in
`.superpowers/sdd/progress.md`; whichever is chosen should be written up here as its own
amendment, since it revises this ADR's foundation rather than an edge of it.
