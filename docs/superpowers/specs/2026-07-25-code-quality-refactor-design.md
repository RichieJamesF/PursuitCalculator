# Code-quality refactor — design spec

Date: 2026-07-25
Status: approved, ready for implementation planning

## Goals

- Improve reliability: async route handlers currently have no consistent error
  handling, so an unexpected DB (or other) error can leave a request hanging
  instead of returning a response.
- Remove duplication and dead code.
- Make the codebase navigable: split the two monolith files (`server.js`,
  `public/app.js`) along the feature seams they already have.
- Add an automated test suite (none exists today, despite README claims) so
  this refactor — and future work — can be verified rather than eyeballed.

## Non-goals

- No behavior changes. Every route, response shape, DB schema, and UI
  interaction stays identical.
- No new runtime dependencies (the app currently depends on only `express`
  and `pg`).
- No frontend build step. The frontend stays plain files served as-is,
  split into native ES modules (`<script type="module">`, plain
  `import`/`export`), the same pattern `lib/engine.mjs` already uses.
- No new features. Functional tweaks are a separate, later spec.

## Current-state findings

From reading the repo (`server.js`, `db.js`, `lib/engine.mjs`,
`lib/strava.mjs`, `public/app.js`, `public/course.js`):

- Most Express route handlers are `async (req, res) => {...}` with no
  try/catch. Express 4 does not catch rejected promises from async handlers,
  so a DB error in an unguarded route leaves the client waiting with no
  response. A handful of routes (event creation, Strava callback/refine) do
  have their own try/catch; most don't.
- `matchByDistance` is exported from `lib/strava.mjs` and imported into
  `server.js` but never called — `server.js` reimplements the same matching
  logic inline instead. Dead code.
- The rider-shaping object literal `{ id, name, w, ftp, pos, build, calib }`
  (or a near-identical subset) is duplicated across four separate route
  handlers in `server.js`.
- The unused `pool` import in `server.js` (only `q()` and `initDb()` are
  actually used).
- README references a `.env.example` file and claims the engine, grouping,
  calibration maths, and browser GPX/FIT parser are "tested (headless)" —
  neither the `.env.example` file nor any test files exist in the repo.
- `lib/engine.mjs` is already pure functions with no DOM dependency — the
  best-shaped file in the repo, needs no structural change.
- `public/course.js`: `parseFit` and the internal (unexported) `buildCourse`
  helper are pure `ArrayBuffer`/array logic with no browser API dependency.
  `parseGpx`'s point extraction depends on the browser's `DOMParser`, which
  Node does not provide natively.
- `public/app.js` (483 lines) is a hand-rolled vanilla-JS SPA: one mutable
  `state` object, an `api()` fetch wrapper, action functions that mutate
  state and call `render()`, and a `render()` dispatcher that rebuilds
  panels via template-string DOM helpers. This pattern is sound and stays
  as-is — the file just needs splitting along its existing responsibilities.

## Backend restructure

```
server.js               App setup only: middleware, static hosting, mounts
                         the routers below, /engine.mjs, /api/health,
                         catch-all, centralized error-handling middleware.
                         Exports createApp() (builds and returns the
                         configured Express app, no listen) separately from
                         the bottom-of-file bootstrap (initDb().then(() =>
                         app.listen(...))), so tests can import the app
                         without starting a real server process.
routes/helpers.js       Shared cross-resource helpers, consolidated from
                         what's currently duplicated/scattered in server.js:
                         token(), genCode(), baseUrl(), getEvent(),
                         getRiders(), publicRider(), paramsOf(),
                         requireOrg(), eventPayload(), eventForRider(), plus
                         named validators for the inline clamps that exist
                         today (group size 1–8, name-length truncation).
routes/events.js        POST/GET/PATCH /api/events(/:code)
routes/riders.js        POST /api/events/:code/riders,
                         PATCH/DELETE /api/riders/:id
routes/groups.js        POST .../suggest, PUT .../groups
routes/strava.js        /auth/strava (+callback), GET .../rides,
                         POST .../refine. Keeps its own freshAccess/isRide/
                         normalizeRide helpers — only used here.
db.js                   Unchanged.
lib/engine.mjs           Unchanged.
lib/strava.mjs           Dead matchByDistance export removed.
```

Each route file exports an Express `Router`; `server.js` mounts them with
`app.use("/api/events", eventsRouter)` etc.

### Error handling

Every async route handler is wrapped in a small `asyncRoute(fn)` helper
(catches a rejected promise, calls `next(err)`), and `server.js` adds one
centralized Express error-handling middleware that logs the error and
returns a generic `500 { error }` JSON body. Handlers that already produce
specific error responses (duplicate event code, Strava request failures)
keep their own try/catch for that — `asyncRoute` is the safety net
underneath, so an unexpected DB error or exception can no longer leave a
request hanging.

### Other fixes

- Delete the dead `matchByDistance` import/export and the unused `pool`
  import in `server.js`.
- Add the `.env.example` the README already documents: `DATABASE_URL`,
  `BASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `PORT`, `PGSSL`.

## Frontend restructure

```
public/app.js            Thin entry point: imports render() from views.js
                          and runs the existing bootstrap logic
                          (if (state.signup) render(); else if (state.code)
                          loadEvent(); else render();).
public/state.js           state object, constants (POSITIONS, BUILDS,
                          SHADES), pure helpers (esc, fmtDur, fmtGap,
                          addClock, gid, el, ridersById, paramsOf, segments).
public/api.js             api(), loadEvent(), syncWork(), persistGroups(),
                          setSaveStatus(), savedEvents() — everything that
                          talks to the backend.
public/actions.js         createEvent, openExisting, toLanding, patchEvent,
                          addRider/updRider/delRider, openRidePicker,
                          applyRefine, autoRefine, bannerFromRefine,
                          detailsMailto, copyDetails.
public/grouping.js        locate, swap, moveTo, toggleLock, breakGroup,
                          clearGroups, newGroup, goSolo, joinBest,
                          suggestLocal, onPick, localSheet, exportCSV.
public/views.js           render() + every panel/card function:
                          renderLanding, renderCreated, renderSignup,
                          coursePanel, groupsPanel, groupCard, chip,
                          riderRow, boardEl, ridePickerEl, profileSvg.
public/course.js          Unchanged except buildCourse is exported (was
                          module-private) so it can be unit tested directly.
public/index.html          Unchanged.
public/styles.css          Unchanged.
```

All modules use native ES module `import`/`export`, loaded via
`<script type="module">` — no bundler, no build step.

Note: `actions.js` and `views.js` import from each other (actions call
`render()` after mutating state; views wire `onclick` handlers to action
functions). This is a circular import, but it's the same relationship that
exists implicitly in the current single file — ES modules handle it
correctly since nothing is invoked until after the module graph finishes
loading. Not a new risk introduced by the split.

## Testing strategy

### Unit tests — `tests/unit/`, run via `node --test tests/unit`

Uses Node's built-in test runner (`node:test` + `node:assert/strict`) — no
new dependency, matches the project's minimal-dependency style, works with
the Node ≥18 the project already requires. No database, no Docker — this is
the fast default suite.

Covers:
- `lib/engine.mjs`: `groupSpeed`/`groupResult` physics, `suggestGroups`
  tiering, `calibrationFactor` bisection + smoothing, `buildManualCourse`,
  `computeSheet` seeding/offsets, `evenness` quality labels.
- `routes/helpers.js`: `publicRider` shaping, `paramsOf` defaults-merge, the
  group-size/name-length validators.
- `public/course.js`: `parseFit` and `buildCourse` (elevation smoothing,
  ascent summation, segment/profile building) — pure logic, no DOM.
  `parseGpx`'s `DOMParser`-dependent node extraction is explicitly out of
  scope for the automated suite (Node has no native `DOMParser` and adding
  one would violate the no-new-dependencies goal); the logic it delegates to
  (`buildCourse`) is fully covered instead. Same coverage status as today.

### Integration tests — `tests/integration/`, run via `npm run test:integration`

- `docker-compose.yml` starts a disposable `postgres:16-alpine` on a
  non-default port, isolated from any local Postgres install, no persistent
  volume.
- A small Node setup script polls the container with a retry loop until
  Postgres is ready (no new dependency), then runs `schema.sql`.
- Tests import `createApp()` from `server.js`, call `app.listen(0)` for an
  ephemeral port, and issue requests with Node's native `fetch` (no
  supertest or other HTTP-testing dependency needed).
- Covers what has never been exercised per the README: event create/fetch/
  patch, rider CRUD, `/suggest` + manual group save, and the
  organiser-token auth check, actually round-tripping through Postgres.

### npm scripts

```
npm test               → node --test tests/unit          (fast, default)
npm run test:integration → docker compose up, node --test tests/integration,
                           docker compose down
npm run test:all       → both
```

## Rollout

Single PR-sized effort covering: backend split + error-handling fix +
dead-code removal + `.env.example`, frontend split, and the test suite
(unit + integration). No behavior changes means this can be verified by:
running the full existing manual flows (create event, rider sign-up,
suggest groups, manual group edits, Strava link/refine, CSV export) plus
the new automated suite, and confirming API responses are byte-for-byte
equivalent to before the split for a sample of each route.
