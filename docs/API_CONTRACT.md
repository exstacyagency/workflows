# API Contract (Frozen Surface)

This document defines the frozen API surface expected to remain stable during the freeze period.

If you need to change this contract, follow `docs/CONTRACT_BUMP.md` and set `FREEZE_OVERRIDE=1` for the PR.

This is the public-facing contract for external integration. It is intentionally minimal here and derived from:

- `docs/ROUTES_MANIFEST.txt` (authoritative route list)
- Golden deterministic E2E (`SECURITY_SWEEP=1 npm run golden:run`)

## Contract Sources

### 1) Route Manifest
`docs/ROUTES_MANIFEST.txt` is the canonical list of API paths and methods.

### 2) Golden E2E Snapshot
Golden run produces:
- `/tmp/golden-output/summary.json` by default (set `GOLDEN_OUT_DIR` to override)
- compared against:
- `e2e/golden/baseline/summary.json` (baseline)

If golden compare fails, external contract drift has occurred.

## Deterministic Mode
When `SECURITY_SWEEP=1`:
- External providers must not be called.
- Generation endpoints must return deterministic placeholders.

This mode is used for:
- CI validation
- Enterprise demos without spending credits
- Reproducible bug reports
