#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
TITLE="${2:-}"

if [ -z "$TAG" ]; then
  echo "Usage: npm run freeze:release -- <tag> [title]" >&2
  echo "Example: npm run freeze:release -- v0.1.2-freeze \"v0.1.2-freeze\"" >&2
  exit 2
fi

if [ -z "$TITLE" ]; then
  TITLE="$TAG"
fi

echo "[freeze-release] verifying clean git state..."
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean. Commit or stash changes first." >&2
  git status --porcelain >&2
  exit 1
fi

echo "[freeze-release] ensuring on main and up to date..."
git checkout main >/dev/null
git pull --ff-only origin main

echo "[freeze-release] running local gates..."
SECURITY_SWEEP=1 npm run golden:run
npm run freeze:check
npm run routes:check

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  exit 1
fi

echo "[freeze-release] creating tag $TAG"
git tag -a "$TAG" -m "Freeze baseline: golden + security + freeze-check + routes-check passing"
git push origin "$TAG"

if command -v gh >/dev/null 2>&1; then
  echo "[freeze-release] creating GitHub release"
  gh release create "$TAG" --title "$TITLE" --notes "Freeze baseline for licensing/buyout. Gates: security-sweep (PR), golden-e2e (PR), freeze-check (PR), routes-check (PR)."
else
  echo "[freeze-release] gh not found; tag pushed. Create release in GitHub UI if desired."
fi

echo "[freeze-release] DONE"
