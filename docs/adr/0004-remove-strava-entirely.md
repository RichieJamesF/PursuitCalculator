---
status: accepted
supersedes: ADR-0001
---

# Remove the Strava integration entirely

**Context**: Strava was in the app to make a rider's FTP a measured number rather than a
guess. Getting there honestly turned out to cost far more than the number was worth. The
original time-based calibration was removed as untrustworthy (ADR-0001). Its replacement —
reading FTP from a ride's power data — needed OAuth, stored access and refresh tokens, a
20-minute eligibility rule, a ride-suggestion picker, and an auth check on a route that had
none. That in turn exposed an account-hijacking flaw: an attacker could have a victim's Strava
tokens written onto the attacker's own rider row and then read the victim's ride history.

Three fixes were attempted — HMAC-signing the OAuth `state`, binding the flow to the
initiating browser with a nonce cookie, and a confirmation page naming the rider. Each closed
one route and left another open, because the root cause is not in the Strava code at all: a
rider key travels in a shareable URL and is auto-adopted as that browser's identity
(ADR-0003), so anyone who sends you a link can put your browser into another rider's session.
Closing it properly meant revising the credential model.

**Decision**: Remove Strava from the app completely — OAuth routes and helpers, stored tokens,
FTP refinement, the ride picker, and the related configuration. Riders enter their own FTP, as
the sign-up form already invites them to. `calib` goes with it: that column and the term in the
engine's `powerOf` existed only to carry refinement, nothing has written a non-1 value since
ADR-0001, and leaving dead plumbing behind is the kind of complexity this decision exists to
remove.

Rider self-service **stays**. Rider keys, `requireRiderOrOrg`, and the rider's own page were
what cut the organiser's per-rider workload, and none of that depended on Strava.

**Consequences**:
- The hijacking risk disappears rather than being mitigated: there are no tokens to steal and
  no third-party account to attach. The open decision that blocked this branch is void.
- The URL-borne rider key still means a link can put a browser into another rider's session,
  but the worst that now grants is editing that rider's weight or FTP on a club start sheet.
  No third-party data is reachable. Recorded so the trade-off stays visible, not because it
  needs action.
- `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` are no longer used. The app needs only
  `DATABASE_URL`, `BASE_URL` and `PORT`.
- The schema drops the four Strava columns, `last_refined_at`, and `calib`. **This is
  destructive and irreversible for any live database** — stored tokens are deleted. That is
  the intent; a removed integration should not leave credentials at rest.
- FTP accuracy now rests entirely on what riders type in. That was always true for riders
  without a power meter, and the start sheet has always been framed as "a planning aid, not a
  promise."
- `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY` are kept. They cost nothing and
  are good practice regardless of what prompted them.
