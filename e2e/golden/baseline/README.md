This directory is the tracked golden baseline.

- `summary.json` is the canonical snapshot.
- `summary.sha256` is its hash (for quick comparisons).

Golden runs write outputs to a temp directory by default (see `GOLDEN_OUT_DIR`).
To intentionally update the baseline:

  npm run golden:update-baseline
