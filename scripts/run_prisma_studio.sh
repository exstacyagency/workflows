#!/usr/bin/env bash
set -euo pipefail

# Ensure prisma studio uses the same .env/.env.local as the app
echo "[run_prisma_studio] Using DATABASE_URL from environment (.env/.env.local via dotenv/config)."
npm run env:db
exec npx prisma studio
