---
status: accepted
---

> **Superseded by [ADR-0004](0004-remove-strava-entirely.md).** Strava was removed from
> the app entirely; nothing described below still exists.

# Strava refinement: FTP-from-power only, drop time-based calibration

**Context**: The app offered two ways to refine a rider's model from Strava — "Use time"
back-solved a power multiplier (`calib`) from an arbitrary recent ride's moving time near
the course distance, modeled as if ridden solo; "FTP from power" read a ride's power data
directly as an FTP estimate. "Use time" couldn't distinguish a stable rider trait from that
day's chosen effort (a casual spin permanently drags `calib` down over successive refinements)
or from real-world drafting in an actual group ride (misread as `calib` above 1, since the
model always scores the ride as if ridden solo). Neither direction produced a number anyone
could trust.

**Decision**: Remove "Use time" / course-distance calibration and `calibrationFactor`
entirely. Keep only "FTP from power," and add a minimum-duration guard (reject/disable
under ~20 minutes) so a short surge can't be read as an FTP. Riders without a power meter
(and without a Strava wattage estimate) get no Strava-based refinement at all — the
organiser edits their FTP number by hand instead. Every rider's stored `calib` is reset to
`1` as a one-time data fix; the column stays in the schema (always `1` going forward) since
`powerOf` in the engine still multiplies by it.

**Consequences**:
- The `matches`/course-distance tagging in the ride picker, the "Use time" button and its
  copy, `calibrationFactor`, and its tests become dead code to remove.
- The `average_watts` (non-power-meter, Strava-estimated) fallback is still trusted for
  FTP-from-power — a variable/surgy ride can still misread as a smooth one at the same
  average. Accepted, mitigated by the new duration guard and the existing "best on a 30–60
  min hard effort" copy.
- Riders with no power data of any kind lose Strava refinement outright. Accepted as the
  honest trade-off — a number nobody can trust is worse than no number.
