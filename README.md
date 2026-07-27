# The Pursuit — server

Multi-user handicap start-sheet calculator. Organisers create an event, riders
sign themselves in, the app tiers them into fair groups (1–8 per group) and
seeds start gaps so everyone converges in one bunch. Riders can link Strava so
their model is refined from real rides.

Same physics engine as the standalone app (`lib/engine.mjs`), so predictions
match. The server does the computing; the browser just renders.

## What's what

```
server.js          App assembly (createApp()) + bootstrap
routes/            Express routers by resource (events, riders, groups,
                    strava) + routes/helpers.js (shared DB/response helpers)
db.js / schema.sql Postgres pool and tables (events, riders)
lib/engine.mjs     N-up paceline physics, grouping, start-sheet, calibration
lib/strava.mjs     Strava OAuth + activity fetch/match
public/            Organiser UI + rider sign-up page (no build step),
                    split into feature modules (state, api, actions,
                    grouping, views)
tests/unit/        Fast tests for pure logic (engine, course parsing,
                    route helpers) — no DB required
tests/integration/ API route tests against a real, disposable local Postgres
                    (no Docker/setup needed — see Testing below)
```

## Deploy on Railway

1. Push this folder to a GitHub repo and create a Railway project from it
   (or `railway up` with the CLI).
2. **Add the Postgres plugin** — Railway sets `DATABASE_URL` automatically. The
   schema is created on first boot.
3. Create a Strava API app at https://www.strava.com/settings/api. Set its
   **Authorization Callback Domain** to your Railway host (e.g.
   `your-app.up.railway.app`, no `https://`).
4. Set env vars (see `.env.example`): `BASE_URL`, `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET`. `PORT` is provided by Railway.
5. Deploy. Start command is `npm start`.

Run locally: `npm install`, set the vars in a `.env` (or your shell), point
`DATABASE_URL` at a local Postgres, then `node server.js`.

## Using it

- **Create an event** → you get an *organiser key*. Keep it: it's the only way
  to edit the event (there are no passwords). Anyone with the key can organise.
- **Share the sign-up link** (`/?code=EVENT&signup=1`). Riders add name, weight,
  FTP, bike/position and build.
- **Set the course** (drop a GPX/FIT, or type distance + ascent) and a **group size**,
  then **Suggest**. The physics assumptions are fixed and not tunable per event
  (see `docs/adr/0002-drop-per-event-physics-tuning.md`).
- **Riders manage themselves**: each rider gets their own link and key at sign-up
  (shown once, remembered on that device). From it they can fix their weight, FTP,
  bike and build, link Strava, set their FTP from a ride, and see their group and
  roll-off time — none of it routed through the organiser.
- **Strava**: linking is per rider. "Set FTP from Strava" offers the rider's hardest
  recent qualifying effort — power data present, at least 20 minutes long — and states
  the exact FTP it will set. Rides that are too short or have no power are listed but
  can't be used. There is no time-based calibration; see
  `docs/adr/0001-strava-refinement-ftp-only.md`.
- **CSV / Print** for the race-day sheet.

## API

```
POST   /api/events                     {name, code?}      -> event + organiserToken
GET    /api/events/:code                                  -> event, riders, groups, sheet
PATCH  /api/events/:code               (org)  {name?, groupSize?, firstStart?, courseManual?, course?, params?}
POST   /api/events/:code/riders                {name,w,ftp,pos,build}  public sign-up -> rider + riderKey
PATCH  /api/riders/:id                 (org | self)
DELETE /api/riders/:id                 (org | self)
POST   /api/events/:code/suggest       (org)  {size?}     compute + store groups
PUT    /api/events/:code/groups        (org)  {groups}    save a manual arrangement
GET    /auth/strava?code=&rider=&key=                     start OAuth (key = organiser or rider key)
GET    /auth/strava/callback                              store tokens
GET    /api/riders/:id/rides           (org | self)       recent rides, hardest usable effort first
POST   /api/riders/:id/refine          (org | self)  {activityId?}   set FTP from a ride's power
DELETE /api/riders/:id/strava          (org | self)       unlink Strava (clears stored tokens)
```

Organiser routes require the `x-organiser-token` header. Rider routes accept either
that or the rider's own `x-rider-token`. `/auth/strava` is a browser navigation and
so takes the key as a `key=` query param instead of a header.

## Testing

- `npm test` — fast unit tests (`tests/unit/`), no DB required: the physics/
  grouping/calibration engine, GPX/FIT course parsing, and the shared route
  helpers/validators.
- `npm run test:integration` — API route tests (`tests/integration/`) against
  a real Postgres, spun up on the fly by `embedded-postgres` (a real Postgres
  binary run directly by Node — no Docker, no install, no admin rights). It's
  created fresh, used, and torn down automatically each run.
- `npm run test:all` — both.

## Honest status

The **engine, grouping, start-sheet seeding, the Strava ride model (FTP
eligibility and suggestion picking), and the browser GPX parser are unit
tested** (headless). The **`.fit` parser is tested for its error path**
(rejects a file with no GPS records) but not against a real device file.
The **organiser UI's group-edit operations** (swap, move, lock, suggest —
`public/grouping.js`) run client-side and are exercised manually, but have
no automated test coverage yet. **Events, riders, groups and the Strava
auth checks have integration tests** against a real Postgres
(`embedded-postgres`, no Docker — `npm run test:integration`): event
create/fetch/patch (incl. the duplicate-code 409 case), rider CRUD under
organiser-or-self auth, group suggest/save, and the `/auth/strava` key
checks (missing/empty/wrong/cross-rider/cross-event key, a signed-state
round-trip, and the nonce-cookie binding: no cookie, wrong cookie, and an
old-format state with no nonce, all refused before the token exchange runs).
One case from the original plan isn't tested —
`POST /api/events/:code/suggest` "requires a course first" — because every
event gets a default course on creation, so that guard is currently
unreachable via the public API; see the comment in
`tests/integration/groups.test.mjs`. What automated tests can't cover is the
live Strava round-trip itself — OAuth against a real account and reading
power off real activities — so verify that by hand with `STRAVA_CLIENT_ID`,
`STRAVA_CLIENT_SECRET` and `BASE_URL` set.

**Strava linking is bound to the browser that started it.** Signing the
OAuth `state` proves the server issued it, but not that the party finishing
the flow is the party who started it — see the amendment at the bottom of
`docs/adr/0003-rider-self-service-via-rider-key.md` for the attack this
closes (sign up your own rider, harvest a valid consent link, hand it to a
victim; without browser binding their tokens land on your rider row).
`GET /auth/strava` now mints a random nonce, folds it into the signed
`state`, and sets it as a short-lived, path-scoped, `HttpOnly`,
`SameSite=Lax` cookie (`Secure` only when the deployment is HTTPS — Railway
terminates TLS at a proxy, so this is derived from `baseUrl(req)`, not
`req.secure`). The callback compares the cookie against the state's nonce
with a timing-safe check *before* calling Strava's token exchange, so a
refused flow never contacts Strava, then clears the cookie either way. A
rider whose browser blocks cookies gets a distinct `stravaerror=nocookie`
banner naming the cause rather than the generic failure message.

The organiser UI now matches the standalone app: tap a rider then another to
swap, "+ here" to move between groups, lock/break groups, an unassigned bench,
and GPX/FIT upload (parsed in the browser, incl. an elevation profile). The
shared engine runs client-side for instant feedback while arrangements are
saved to the server via `PUT /api/events/:code/groups`, so every viewer sees
the same sheet. The manual distance+ascent path still covers courses without a
file.
