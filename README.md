# The Pursuit — server

Multi-user handicap start-sheet calculator. Organisers create an event, riders
sign themselves in, the app tiers them into fair groups (1–8 per group) and
seeds start gaps so everyone converges in one bunch. Riders can link Strava so
their model is refined from real rides.

Same physics engine as the standalone app (`lib/engine.mjs`), so predictions
match. The server does the computing; the browser just renders.

## What's what

```
server.js          Express API + Strava OAuth + static hosting
db.js / schema.sql Postgres pool and tables (events, riders)
lib/engine.mjs     N-up paceline physics, grouping, start-sheet, calibration
lib/strava.mjs     Strava OAuth + activity fetch/match
public/            Organiser UI + rider sign-up page (no build step)
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

## Honest status

The **engine, grouping, start-sheet seeding and calibration maths are tested**
(headless). The **DB and Strava OAuth round-trip need your live config** and
haven't been exercised end-to-end here — stand it up on Railway with a Postgres
plugin and a Strava app to try the full loop. The frontend is intentionally
simpler than the standalone app (no drag-to-swap yet); the richer UI can be
ported over this same API later. GPX/FIT courses can be parsed in the browser
(as the standalone app does) and posted to `PATCH /api/events/:code` as a
`course` object; the manual distance+ascent path covers most club courses.
