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
- **Set the course** (distance + ascent) and a **group size**, then **Suggest**.
- **Strava**: each rider taps *Link Strava*; after a ride, *Refine* finds their
  most recent ride near the course distance and nudges their calibration so
  future predictions match their real form. Refinement is smoothed, so one odd
  ride won't swing it.
- **CSV / Print** for the race-day sheet.

## API

```
POST   /api/events                     {name, code?}      -> event + organiserToken
GET    /api/events/:code                                  -> event, riders, groups, sheet
PATCH  /api/events/:code               (org)  {name?, groupSize?, firstStart?, courseManual?, course?, params?}
POST   /api/events/:code/riders               {name,w,ftp,pos,build}   public sign-up
PATCH  /api/riders/:id                 (org)
DELETE /api/riders/:id                 (org)
POST   /api/events/:code/suggest       (org)  {size?}     compute + store groups
PUT    /api/events/:code/groups        (org)  {groups}    save a manual arrangement
GET    /auth/strava?code=&rider=                          start OAuth
GET    /auth/strava/callback                              store tokens
POST   /api/riders/:id/refine          (org)              Strava -> calibration
```

Organiser routes require the `x-organiser-token` header.

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

The **engine, start-sheet seeding, calibration maths, and the browser GPX
parser are tested** (headless). The **`.fit` parser is tested for its error
path** (rejects a file with no GPS records) but not against a real device
file. The **organiser UI's group-edit operations** (swap, move, lock,
suggest — `public/grouping.js`) run client-side and are exercised manually,
but have no automated test coverage yet. The **API routes are exercised
end-to-end against a real Postgres** via `npm run test:integration`: event
create/fetch/patch (incl. the duplicate-code 409 case), rider CRUD, group
suggest/save, and the organiser-token auth check on every protected route.
One case from the original plan isn't tested — `POST /api/events/:code/suggest`
"requires a course first" — because every event gets a default course on
creation, so that guard is currently unreachable via the public API; see the
comment in `tests/integration/groups.test.mjs`. The **Strava OAuth
round-trip still needs your live config** and hasn't been exercised
end-to-end here — stand it up on Railway with a Postgres plugin and a
Strava app to try that part of the loop.

The organiser UI now matches the standalone app: tap a rider then another to
swap, "+ here" to move between groups, lock/break groups, an unassigned bench,
and GPX/FIT upload (parsed in the browser, incl. an elevation profile). The
shared engine runs client-side for instant feedback while arrangements are
saved to the server via `PUT /api/events/:code/groups`, so every viewer sees
the same sheet. The manual distance+ascent path still covers courses without a
file.
