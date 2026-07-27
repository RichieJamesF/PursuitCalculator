# The Pursuit

A handicap start-sheet calculator for group rides: riders are tiered into ability groups
from a shared physics model, then given staggered start times so all groups are predicted
to converge into one bunch.

## Language

**Organiser key**:
The credential granting edit rights over an entire event — course, riders, groups,
start-sheet. Minted once at event creation, shown once, remembered automatically in the
creating browser. No recovery path if lost.
_Avoid_: Organiser token (the DB column/header name — "key" is the term shown to humans)

**Rider key**:
The credential granting a rider edit rights over their own row only — name, weight, FTP,
position, build. Minted once at sign-up, shown once, remembered automatically in the
signing-up browser. A lost rider key falls back to asking the organiser to delete and
re-add the rider, the same recovery story as a lost organiser key. See
[ADR-0003](docs/adr/0003-rider-self-service-via-rider-key.md).
_Avoid_: Rider token (DB column/header name), rider password

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
