#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[e2e] deterministic start"

BASE_URL="${BASE_URL:-http://localhost:3000}"
KEEP_E2E_SERVER="${KEEP_E2E_SERVER:-0}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_URL="${HEALTH_URL:-${BASE_URL}${HEALTH_PATH}}"

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

# Always load isolated test environment; never fall back to .env.
load_env_file ".env.test"

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  export DATABASE_URL="${TEST_DATABASE_URL}"
fi

required_envs=("TEST_DATABASE_URL" "DATABASE_URL" "NEXTAUTH_SECRET" "DEBUG_ADMIN_TOKEN")
for k in "${required_envs[@]}"; do
  if [ -z "${!k:-}" ]; then
    echo "[e2e] Missing required env: $k" >&2
    exit 1
  fi
done

export SECURITY_SWEEP="${SECURITY_SWEEP:-1}"
export MODE="${MODE:-alpha}"

echo "[e2e] migrate deploy"
npx prisma migrate deploy

echo "[e2e] prisma generate"
npx prisma generate

echo "[e2e] bootstrap:dev"
npm run bootstrap:dev

SERVER_PID=""
WORKER_PID=""

cleanup() {
  if [ "${KEEP_E2E_SERVER}" = "1" ]; then
    echo "[e2e] cleanup skipped (KEEP_E2E_SERVER=1)"
    return
  fi
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

echo "${WORKER_PID}" >/tmp/e2e_worker.pid

echo "[e2e] start server"
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -i :3000 -t 2>/dev/null || true)"
  if [ -n "${EXISTING_PIDS}" ]; then
    echo "[e2e] clearing port 3000 (pids: ${EXISTING_PIDS})"
    kill ${EXISTING_PIDS} >/dev/null 2>&1 || true
  fi
fi
if command -v fuser >/dev/null 2>&1; then
  if fuser 3000/tcp >/dev/null 2>&1; then
    echo "[e2e] port 3000 in use (fuser), killing"
    fuser -k 3000/tcp >/dev/null 2>&1 || true
  fi
fi
rm -rf .next
npm run dev -- --port 3000 >/tmp/e2e_server.log 2>&1 &
SERVER_PID=$!

echo "${SERVER_PID}" >/tmp/e2e_server.pid

echo "[e2e] wait for health"
for i in $(seq 1 60); do
  # If the server is up but health path is wrong, we'll see 404 here.
  # Print first line of response occasionally to make debugging obvious.
  HTTP_CODE="$(curl -sS -o /tmp/e2e_health_body.txt -w '%{http_code}' "${HEALTH_URL}" || true)"
  if [ "${HTTP_CODE}" = "200" ]; then
    echo "[e2e] healthy (${HEALTH_URL})"
    break
  fi
  if [ "$i" = "1" ] || [ "$i" = "10" ] || [ "$i" = "30" ] || [ "$i" = "60" ]; then
    echo "[e2e] health not ready yet (attempt ${i}/60, code=${HTTP_CODE}, url=${HEALTH_URL})"
    head -c 200 /tmp/e2e_health_body.txt 2>/dev/null || true
    echo ""
  fi
  sleep 1
done

# Final check: fail if we never got a 200
HTTP_CODE="$(curl -sS -o /tmp/e2e_health_body.txt -w '%{http_code}' "${HEALTH_URL}" || true)"
if [ "${HTTP_CODE}" != "200" ]; then
  echo "[e2e] server did not become healthy (code=${HTTP_CODE}, url=${HEALTH_URL})" >&2
  echo "[e2e] last health body:" >&2
  cat /tmp/e2e_health_body.txt >&2 || true
  echo "" >&2
  echo "[e2e] last server log tail:" >&2
  tail -n 80 /tmp/e2e_server.log >&2 || true
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
  exit 1
fi

echo "[e2e] run sweep"
npm run security:sweep

echo "[e2e] PASS"
