# The Pursuit

A handicap start-sheet calculator for group rides: riders are tiered into ability groups
from a shared physics model, then given staggered start times so all groups are predicted
to converge into one bunch.

## Language

**Refine**:
The action of updating a rider's FTP directly from their linked Strava ride's power
data — a real, sustained hard effort read from the athlete, subject to a minimum-duration
guard. Triggerable by the rider themselves (via their [rider key](#language)) or by the
organiser on their behalf. See [ADR-0001](docs/adr/0001-strava-refinement-ftp-only.md).
_Avoid_: Calibrate, Use time (removed mode)

**Organiser key**:
The credential granting edit rights over an entire event — course, riders, groups,
start-sheet. Minted once at event creation, shown once, remembered automatically in the
creating browser. No recovery path if lost.
_Avoid_: Organiser token (the DB column/header name — "key" is the term shown to humans)

**Rider key**:
The credential granting a rider edit rights over their own row only — name, weight, FTP,
position, build, and their own Strava link/refine. Minted once at sign-up, shown once,
remembered automatically in the signing-up browser. A lost rider key falls back to asking
the organiser to delete and re-add the rider, the same recovery story as a lost organiser
key. See [ADR-0003](docs/adr/0003-rider-self-service-via-rider-key.md).
_Avoid_: Rider token (DB column/header name), rider password

**Calib**:
A power multiplier stored per rider, always `1` as of ADR-0001. Historically set by a
now-removed "Use time" mode that tried to back-solve it from an arbitrary ride's moving
time; kept in the schema only because the engine's `powerOf` formula still multiplies by
it. Not something any current flow writes a non-1 value into.
_Avoid_: Calibration factor (as a live, tunable concept — it isn't one anymore)

**Front share**:
The fraction of total ride time a rider spends on the front of a pursuit group's rotating
paceline, driven by their sustainable power relative to the rest of the group at the
group's steady-state speed. Displayed as a percentage and as the width of a rider's
segment in a group's turn bar.
_Avoid_: Pull time, turn

**Evenness** (Even / Fair / Uneven):
A quality label for how evenly a group's front shares are spread across its members —
tight spread is "Even," wide spread is "Uneven." Used to flag groups where the physics
model expects one rider to do disproportionately more work on the front.
_Avoid_: Balance, fairness score
