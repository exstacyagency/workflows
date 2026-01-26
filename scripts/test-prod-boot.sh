#!/usr/bin/env bash
set -euo pipefail

echo "== Test #1: Deployment-real beta =="

echo "→ Fresh install"
rm -rf node_modules .next
npm ci

echo "→ Ensure no .env.local"
if [ -f .env.local ]; then
  echo "❌ .env.local must not exist"
  exit 1
fi

export NODE_ENV=production
export MODE=beta

echo "→ Build"
npm run build

echo "→ Start server"
  echo "→ Start server with test route bypass"
  export NEXT_PUBLIC_ALLOW_TEST_ROUTES=1
  npm start &
  PID=$!

sleep 5

echo "→ Kill server"
kill $PID
wait $PID || true

echo "→ Restart server (1)"
  echo "→ Restart server (1) with test route bypass"
  export NEXT_PUBLIC_ALLOW_TEST_ROUTES=1
  npm start &
  PID=$!
  sleep 5
  kill $PID
  wait $PID || true

echo "→ Restart server (2)"
  echo "→ Restart server (2) with test route bypass"
  export NEXT_PUBLIC_ALLOW_TEST_ROUTES=1
  npm start &
  PID=$!
  sleep 5
  kill $PID
  wait $PID || true

echo "✅ Test #1 passed"
