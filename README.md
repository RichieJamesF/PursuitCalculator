# The Pursuit — server

Multi-user handicap start-sheet calculator. Organisers create an event, riders
sign themselves in, the app tiers them into fair groups (1–8 per group) and
seeds start gaps so everyone converges in one bunch.

Same physics engine as the standalone app (`lib/engine.mjs`), so predictions
match. The server does the computing; the browser just renders.

## What's what

```
server.js          App assembly (createApp()) + bootstrap
routes/            Express routers by resource (events, riders, groups)
                    + routes/helpers.js (shared DB/response helpers)
db.js / schema.sql Postgres pool and tables (events, riders)
lib/engine.mjs     N-up paceline physics, grouping, start-sheet seeding
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
3. Set env vars (see `.env.example`): `BASE_URL`. `PORT` is provided by Railway.
4. Deploy. Start command is `npm start`.

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
  bike and build, and see their group and roll-off time — none of it routed
  through the organiser.
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
```

Organiser routes require the `x-organiser-token` header. Rider routes accept either
that or the rider's own `x-rider-token`.

## Testing

- `npm test` — fast unit tests (`tests/unit/`), no DB required: the physics/
  grouping engine, GPX/FIT course parsing, and the shared route
  helpers/validators.
- `npm run test:integration` — API route tests (`tests/integration/`) against
  a real Postgres, spun up on the fly by `embedded-postgres` (a real Postgres
  binary run directly by Node — no Docker, no install, no admin rights). It's
  created fresh, used, and torn down automatically each run.
- `npm run test:all` — both.

## Honest status

The **engine, grouping, start-sheet seeding, and the browser GPX parser are
unit tested** (headless). The **`.fit` parser is tested for its error path**
(rejects a file with no GPS records) but not against a real device file.
The **organiser UI's group-edit operations** (swap, move, lock, suggest —
`public/grouping.js`) run client-side and are exercised manually, but have
no automated test coverage yet. **Events, riders and groups have integration
tests** against a real Postgres (`embedded-postgres`, no Docker —
`npm run test:integration`): event create/fetch/patch (incl. the
duplicate-code 409 case), rider CRUD under organiser-or-self auth, and group
suggest/save. One case from the original plan isn't tested —
`POST /api/events/:code/suggest` "requires a course first" — because every
event gets a default course on creation, so that guard is currently
unreachable via the public API; see the comment in
`tests/integration/groups.test.mjs`.

The organiser UI now matches the standalone app: tap a rider then another to
swap, "+ here" to move between groups, lock/break groups, an unassigned bench,
and GPX/FIT upload (parsed in the browser, incl. an elevation profile). The
shared engine runs client-side for instant feedback while arrangements are
saved to the server via `PUT /api/events/:code/groups`, so every viewer sees
the same sheet. The manual distance+ascent path still covers courses without a
file.
