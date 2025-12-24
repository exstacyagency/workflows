#!/usr/bin/env bash
set -euo pipefail

echo "[run_dev] Printing active DB env before starting dev server:"
npm run env:db
exec npm run dev
