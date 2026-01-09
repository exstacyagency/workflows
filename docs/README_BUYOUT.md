# Buyout / Licensing README

This repo is structured to be evaluated and licensed/bought with deterministic, auditable behavior.

## What this product does
- End-to-end pipeline from research -> creative generation (scripts/storyboards/etc.) with job orchestration.

## What is "frozen"
The following are treated as a contract:
- Surface contract: documented inputs/outputs and endpoints (see `docs/API_CONTRACT.md`)
- Golden baseline: deterministic E2E snapshot + hash (see `e2e/golden/baseline/`)
- Freeze contract rules: enforced by CI (see `docs/FREEZE_CONTRACT.md` and `docs/CONTRACT_BUMP.md`)

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

## CI guarantees (PR gates)
Required checks should include:
- CodeQL
- `freeze-check` (freeze contract)
- `golden-e2e` (deterministic snapshot compare)
- `security-sweep` (PR-safe version)

## What's intentionally out of scope
- Production hosting and billing ops (CI proves correctness; deployment is a separate concern)
- Non-deterministic model calls during "golden" runs (golden is intentionally deterministic)
