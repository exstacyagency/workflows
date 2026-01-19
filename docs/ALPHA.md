# Alpha Testing Scope

This document defines what “alpha” means for this codebase. If something is not written here, it is not promised.

## In Scope (what we are testing)

- End-to-end job execution flows (API → worker → persistence → result)
- Tier gating and quota enforcement (FREE / GROWTH)
- Idempotency guarantees for job creation and spend events
- Core project lifecycle (bootstrap, job creation, job execution, cleanup)
- Golden-path regressions (golden driver + snapshot + compare)
- Error handling that affects correctness (not UX polish)

## Explicitly Out of Scope

- UI/UX polish or visual correctness
- Performance optimization beyond obvious correctness bugs
- New feature requests or product direction changes
- Backward compatibility guarantees for undocumented APIs
- Data migration tooling beyond existing Prisma migrations

## Must Not Break (hard constraints)

- Database integrity (no orphaned rows, no partial writes)
- Idempotency of job and spend-related endpoints
- Tier and quota enforcement correctness
- Auth boundaries between users/projects
- Golden snapshots (no regeneration to “make tests pass”)

Any violation here is a P0 and blocks alpha progress.

## What Testers Should Actively Try to Break

- Replaying the same request multiple times
- Running jobs concurrently against the same project
- Exceeding quotas and tier limits
- Restarting workers mid-job
- Invalid or missing inputs on job-related endpoints

## What Feedback Is Useless

- Feature requests (“it should also do X”)
- UX suggestions without correctness impact
- Performance complaints without repro data
- Bug reports without repro steps or logs

## Deployment Cadence

- Maximum one alpha deploy per day
- No hotfix deploys without updating alpha notes

## Exit Criteria (defined before alpha starts)

Alpha ends only when **all** are true:

- Zero P0 correctness bugs for 7 consecutive days
- Golden tests stable across 3 consecutive deploys
- No schema rollbacks or migration edits

If criteria are not met, alpha continues.
