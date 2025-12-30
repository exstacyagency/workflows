# Golden Path (Input / Output / CI)

## Golden Input
- `e2e/golden/input.json`

## Golden Output
- `e2e/golden/output/summary.json`
- `e2e/golden/output/summary.sha256`

## CI Comparison
- CI runs `npm run golden:run` on PRs using a local Postgres service.
- If `e2e/golden/baseline/summary.json` is replaced with a real baseline, CI enforces exact normalized match.

### Set baseline intentionally
1) Run locally:
   - `SECURITY_SWEEP=1 npm run golden:run`
2) Copy:
   - `cp e2e/golden/output/summary.json e2e/golden/baseline/summary.json`
3) Commit baseline in a PR.

