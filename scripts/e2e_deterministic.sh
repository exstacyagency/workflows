#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[e2e] deterministic start"

load_env_file() {
  local f="$1"
  if [ -f "$f" ]; then
    echo "[e2e] loading env from $f"
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
  fi
}

# Load env if caller didn't export it already
if [ -z "${DATABASE_URL:-}" ] || [ -z "${NEXTAUTH_SECRET:-}" ] || [ -z "${DEBUG_ADMIN_TOKEN:-}" ]; then
  load_env_file ".env.local"
  load_env_file ".env"
fi

required_envs=("DATABASE_URL" "NEXTAUTH_SECRET" "DEBUG_ADMIN_TOKEN")
for k in "${required_envs[@]}"; do
  if [ -z "${!k:-}" ]; then
    echo "[e2e] Missing required env: $k" >&2
    exit 1
  fi
done

export SECURITY_SWEEP="${SECURITY_SWEEP:-1}"

echo "[e2e] migrate deploy"
npx prisma migrate deploy

echo "[e2e] bootstrap:dev"
npm run bootstrap:dev

SERVER_PID=""
WORKER_PID=""

cleanup() {
  echo "[e2e] cleanup"
  if [ -n "${WORKER_PID}" ] && kill -0 "${WORKER_PID}" >/dev/null 2>&1; then
    kill "${WORKER_PID}" || true
  fi
  if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" || true
  fi
}
trap cleanup EXIT

echo "[e2e] start worker"
npm run worker >/tmp/e2e_worker.log 2>&1 &
WORKER_PID=$!

echo "[e2e] start server"
npm run dev -- --port 3000 >/tmp/e2e_server.log 2>&1 &
SERVER_PID=$!

echo "[e2e] wait for health"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/api/health >/dev/null; then
    echo "[e2e] healthy"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "[e2e] server did not become healthy" >&2
    echo "---- server log (tail) ----" >&2
    tail -n 200 /tmp/e2e_server.log >&2 || true
    echo "---- worker log (tail) ----" >&2
    tail -n 200 /tmp/e2e_worker.log >&2 || true
    exit 1
  fi
done

echo "[e2e] run sweep"
npm run security:sweep

echo "[e2e] PASS"
