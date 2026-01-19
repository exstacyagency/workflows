#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "[alpha] smoke test"

curl -f "${BASE_URL}/api/health"

curl -f -X POST "${BASE_URL}/api/jobs" \
  -H "Content-Type: application/json" \
  -H "x-user-email: test@local.dev" \
  -d '{"type":"CUSTOMER_RESEARCH","projectId":"proj_test"}'

echo "[alpha] smoke OK"
