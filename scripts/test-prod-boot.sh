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
npm start &
PID=$!

sleep 5

echo "→ Kill server"
kill $PID
wait $PID || true

echo "→ Restart server (1)"
npm start &
PID=$!
sleep 5
kill $PID
wait $PID || true

echo "→ Restart server (2)"
npm start &
PID=$!
sleep 5
kill $PID
wait $PID || true

echo "✅ Test #1 passed"
