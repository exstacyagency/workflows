#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"

fail() {
  echo "❌ $1"
  exit 1
}

assert_status() {
  local method="$1"
  local path="$2"
  local expected="$3"

  status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path")

  if [ "$status" != "$expected" ]; then
    fail "$method $path → expected $expected, got $status"
  fi

  echo "✔ $method $path → $status"
}

echo "🔒 Verifying production guardrails"

# e2e reset MUST NOT exist
assert_status POST /api/e2e/reset 404

# debug routes MUST NOT exist
assert_status GET /api/debug/whoami 404
assert_status GET /api/debug/mint-session 404
assert_status GET /api/debug/clear-auth-throttle 404

# health MUST stay public
assert_status GET /api/health 200

echo "✅ Production guardrails verified"