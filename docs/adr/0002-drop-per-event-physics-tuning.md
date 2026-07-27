---
status: accepted
---

# Drop per-event physics-parameter tuning

**Context**: `events.params_json` and `PATCH /api/events/:code` have long supported
per-event overrides for the model's physics assumptions (`rho`, `crr`, `eta`, `bikeMass`,
`draftSaving`, `effort`, `descentCapKmh`, `climbGrad`), and the footer on every screen
claimed *"Tune the assumptions to your roads and riders."* But no control anywhere in
`public/` ever sends a `params` body — the only near-miss is the manual-course form, which
re-persists whatever `climbGrad` is already stored rather than letting the organiser set
it. Every event that has ever existed runs on `DEFAULT_PARAMS`, untouched.

**Decision**: Drop the "tune your own assumptions" feature rather than build a settings
UI for it. The footer copy no longer promises it (now just "Theoretical times — a
planning aid, not a promise."). The `params_json` column and the `PATCH .../events/:code
{params}` API path stay as-is — harmless to leave, and still usable directly if a one-off
support case ever needs it — but they are deliberately not a discoverable, supported
product feature.

**Consequences**: A future reader of `routes/events.js` or `lib/engine.mjs` who notices
the full plumbing for adjustable physics params should not assume it's a live, exposed
feature — it's dead by decision, not by accident.
