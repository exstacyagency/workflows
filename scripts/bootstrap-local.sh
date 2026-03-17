#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[bootstrap-local] Created .env from .env.example"
fi

echo "[bootstrap-local] Installing dependencies..."
npm install

echo "[bootstrap-local] Generating Prisma client..."
npx prisma generate

echo "[bootstrap-local] Running database migrations..."
npx prisma migrate deploy

echo "[bootstrap-local] Seeding bootstrap admin/project..."
npm run bootstrap

echo "[bootstrap-local] Starting app + worker..."
npx concurrently "npm run dev" "npm run worker"
