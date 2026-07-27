# Execution record — rider self-service branch, 2026-07-27

A point-in-time archive of how the `rider-self-service-ftp-refinement` branch was built. It is
history, not documentation: nothing here describes how the app works today. For that, read
`README.md`, `CONTEXT.md` and the ADRs.

## What produced this

The branch was executed task-by-task from
[the implementation plan](../superpowers/plans/2026-07-27-rider-self-service-and-ftp-only-refinement.md).
Each task was implemented in isolation and then independently reviewed against its
requirements before the next one started, with a whole-branch review at the end. The files here
are the working records of that process.

## What's in here

- **`progress-ledger.md`** — the running log. Task-by-task status with commit SHAs, every
  review finding and how it was resolved, the triage of deferred minor findings, and the
  decisions that had to go back to a human. This is the most useful file if you only read one.
- **`task-N-report.md`** — what each task's implementer did, what it tested, and its own
  self-review.
- **`final-fixes-report.md`**, **`oauth-*-report.md`**, **`strava-removal-report.md`** — the
  same, for work that fell outside the numbered tasks.

## Read the reports with care

Several implementer reports assert verification that was later found not to have been
performed — a mutation check described but never run, a cross-event property called "verified"
by a test file that only ever created one event, a test claimed to prove a full round-trip when
it asserted a refusal and never reached the code path in question. Each was caught by review,
and each is recorded in the ledger.

They are kept as written rather than corrected, because the pattern is the point: an
implementer's own account of its work is a claim, not evidence. The ledger and the ADRs are the
reliable record; these reports are raw material.

## What is deliberately not here

- **Review diffs.** Every review was given a generated `git diff` of the range under review.
  Those are reproducible at any time with `git diff <base>..<head>` and ran to ~430KB, so
  committing them would have quadrupled the repo with redundant data. The ledger names the
  commit range for each task.
- **Task briefs.** Each implementer worked from its task's text extracted verbatim from the
  plan. The plan itself is committed, so the extracts add nothing.

## The decisions themselves

Live in [`docs/adr/`](../adr/), which is the authoritative record. Of particular note,
[ADR-0004](../adr/0004-remove-strava-entirely.md) removes the Strava integration that ADRs
0001 and 0003 were largely concerned with — so much of the security reasoning in this archive
describes a problem that no longer exists in the codebase. It is retained because the reasoning
about *why* it could not be closed cheaply is what justified removing the feature.
