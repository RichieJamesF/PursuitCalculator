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
  "upgrade" this to cookies or sessions without revisiting this ADR.
- The organiser's own Strava link (`href="/auth/strava?code=…&rider=…&key=…"` in the rider
  list) carries the *organiser* token the same way, and the "grants edit rights over exactly
  one rider row" reasoning above doesn't cover that key — it grants edit rights over the whole
  event. That link 302s cross-origin to strava.com, so under a browser (or embedded webview)
  still defaulting to `no-referrer-when-downgrade` the full URL, key included, would reach
  Strava as a referrer. Mitigated with an explicit `Referrer-Policy: no-referrer` set on every
  response in `createApp()`, rather than relying on the modern browser default.
