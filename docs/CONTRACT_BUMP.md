# Contract Bump Policy

## What counts as a contract change
Any PR that modifies:
- `e2e/golden/baseline/**`
- `docs/FREEZE_CONTRACT.md`
- `docs/API_CONTRACT.md`
- `docs/CONTRACT_BUMP.md`

...is a contract bump and requires explicit override.

## How to do a contract bump (controlled process)
1) Re-run golden locally:
```bash
SECURITY_SWEEP=1 npm run golden:run
```

2) If the change is intended, update baseline (example):
```bash
npm run golden:update-baseline
```

3) Open a PR that includes:
- The updated baseline files
- A clear PR title prefix: `contract:` or `freeze:`
- CI override enabled (see below)

## CI override
Contract bump PRs must set:
- `FREEZE_OVERRIDE=1`

If not set, CI blocks the PR.
