# Buyout / Licensing README

This repo is structured to be evaluated and licensed/bought with deterministic, auditable behavior.

## What this product does
- End-to-end pipeline from research -> creative generation (scripts/storyboards/etc.) with job orchestration.

## Canonical diligence docs

For buyer diligence, use these docs as the current truth sources:

- `docs/SECURITY_GAPS.md`
  - authoritative implementation backlog and status labels
- `docs/SECURITY_OVERVIEW.md`
  - concise current-state auth, ownership, and isolation summary
- `docs/SECURITY_AND_DATA_ARCHITECTURE.md`
  - canonical technical diligence document for trust boundaries, deletion, export, retention, logging, and secrets posture
- `docs/RLS_DISCLOSURE.md`
  - explicit current statement on RLS and what is not yet proven
- `docs/DATA_RETENTION_POLICY.md`
  - current retention posture
- `docs/SECRET_ROTATION_RUNBOOK.md`
  - current rotation and transfer expectations

## What is "frozen"
The following are treated as a contract:
- Surface contract: documented inputs/outputs and endpoints (see `docs/API_CONTRACT.md`)
- Golden baseline: deterministic E2E snapshot + hash (see `e2e/golden/baseline/`)
- Freeze contract rules: enforced by CI (see `docs/FREEZE_CONTRACT.md` and `docs/CONTRACT_BUMP.md`)

Important distinction:

- the frozen contract and golden flow prove reproducible contract behavior for the checked evaluation path
- they do not, by themselves, prove full production security, full ops maturity, or full compliance readiness

## Deterministic local evaluation (one command)
Prereqs:
- `.env.local` includes: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (or `APP_URL`), `DEBUG_ADMIN_TOKEN`

Run:
```bash
SECURITY_SWEEP=1 npm run golden:run
```

This executes:
- deterministic E2E bringup
- golden driver actions
- golden snapshot
- golden compare against baseline

What this does prove:

- the checked deterministic evaluation path is reproducible
- the frozen contract can be validated locally
- major app flows can be exercised in a controlled buyer-style environment

What this does not prove on its own:

- full staging/production security posture
- deployed RLS enforcement
- complete cross-tenant negative coverage
- full provider-account operational readiness
- complete incident-response/compliance maturity

## CI guarantees (PR gates)
Required checks should include:
- CodeQL
- `freeze-check` (freeze contract)
- `golden-e2e` (deterministic snapshot compare)
- `security-sweep` (PR-safe version)

Conservative note:

- the deterministic and CI evaluation story is strongest for contract stability and reproducible behavior
- buyer security conclusions should still be taken from the canonical security docs listed above, not inferred from CI alone

## What is proven vs not yet proven

Currently proven from the repo and current diligence docs:

- authenticated app-layer ownership checks are broadly implemented
- project-scoped and, where applicable, user-scoped query enforcement exists on key routes
- deterministic evaluation and freeze-contract behavior exist as real checked artifacts
- project-wide purge exists
- partial export capability exists
- secret rotation expectations are documented

Not yet proven or not yet closed:

- DB-layer RLS as the active buyer-grade isolation control
- staging/production RLS enforcement proof
- a complete top-20 cross-tenant negative-test suite
- exhaustive job-read no-leak verification across every route
- tenant-wide purge
- full project export bundle
- formal audit-log retention, incident response, and access-review maturity

## Known architectural simplifications

**Run model**: Research runs and creative runs currently share the same `ResearchRun` record. Creative jobs are attached to the same run as the research jobs that sourced them. This is a deliberate simplification — the pipeline works end to end, but a single research run cannot fan out into multiple independent creative runs without modification. The separation path is documented in the main README roadmap under "Creative Run Branching".

## What's intentionally out of scope
- Production hosting and billing ops beyond the repo-verifiable artifacts here
- Non-deterministic model calls during "golden" runs (golden is intentionally deterministic)
- Representing deterministic eval as full production-readiness proof
