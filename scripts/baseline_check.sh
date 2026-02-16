#!/usr/bin/env bash
set -euo pipefail

# Ensure core env is loaded before starting services.
load_env_file() {
	local f="$1"
	if [ -f "$f" ]; then
		echo "[baseline] loading env from $f"
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
		echo "[baseline] Missing required env: $k" >&2
		exit 1
	fi
done

BASE_URL="${BASE_URL:-http://localhost:3000}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_URL="${HEALTH_URL:-${BASE_URL}${HEALTH_PATH}}"

# Baseline must run in a known runtime mode.
# Alpha is the safest default for validation.
export MODE=alpha
export SECURITY_SWEEP=1

echo "==> Baseline runtime MODE=$MODE"

# Deterministic inputs for baseline validation
export PROJECT_ID=proj_baseline

echo "==> Running clean baseline checks"

echo "-> npm ci"
npm ci

echo "-> npm run lint"
npm run lint

echo "-> npm test"
npm test

echo "-> prisma migrate deploy"
npx prisma migrate deploy

echo "-> bootstrap:dev"
npm run bootstrap:dev

echo "-> ensure attacker project"
PROJECT_ID="$PROJECT_ID" node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
	const projectId = process.env.PROJECT_ID;
	const attacker = await prisma.user.findUnique({ where: { email: 'attacker@local.dev' } });
	if (!attacker) throw new Error('attacker user missing');
	await prisma.project.upsert({
		where: { id: projectId },
		create: {
			id: projectId,
			name: 'Baseline Smoke Project',
			description: 'Created by baseline_check.sh',
			userId: attacker.id,
		},
		update: { userId: attacker.id },
	});
	console.log(`✔ project ${projectId} for attacker@local.dev`);
})()
	.catch((e) => { console.error(e); process.exit(1); })
	.finally(() => prisma.$disconnect());
EOFNODE

SERVER_PID=""
WORKER_PID=""

cleanup() {
	if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
		kill "$WORKER_PID" || true
	fi
	if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
		kill "$SERVER_PID" || true
	fi
}
trap cleanup EXIT

echo "-> start worker"
npm run worker >/tmp/baseline_worker.log 2>&1 &
WORKER_PID=$!

echo "-> start dev server"
npm run dev -- --port 3000 >/tmp/baseline_server.log 2>&1 &
SERVER_PID=$!

echo "-> wait for health"
for i in $(seq 1 60); do
	HTTP_CODE="$(curl -sS -o /tmp/baseline_health_body.txt -w '%{http_code}' "${HEALTH_URL}" || true)"
	if [ "${HTTP_CODE}" = "200" ]; then
		echo "-> healthy (${HEALTH_URL})"
		break
	fi
	if [ "$i" = "1" ] || [ "$i" = "10" ] || [ "$i" = "30" ] || [ "$i" = "60" ]; then
		echo "-> health not ready yet (attempt ${i}/60, code=${HTTP_CODE}, url=${HEALTH_URL})"
		head -c 200 /tmp/baseline_health_body.txt 2>/dev/null || true
		echo ""
	fi
	sleep 1
done

# Final check before hitting endpoints
HTTP_CODE="$(curl -sS -o /tmp/baseline_health_body.txt -w '%{http_code}' "${HEALTH_URL}" || true)"
if [ "${HTTP_CODE}" != "200" ]; then
	echo "ERROR: dev server did not become healthy (code=${HTTP_CODE}, url=${HEALTH_URL})" >&2
	echo "last health body:" >&2
	cat /tmp/baseline_health_body.txt >&2 || true
	echo "" >&2
	echo "server log tail:" >&2
	tail -n 80 /tmp/baseline_server.log >&2 || true
	exit 1
fi

echo "-> e2e smoke (baseline)"
bash scripts/smoke_membership.sh \
	--project-id proj_baseline \
	--password "Test1234!Test1234!" \
	--endpoints "/api/jobs/customer-research" \
	--quota-endpoint "/api/jobs/customer-research"

# Stop background services before continuing
cleanup
SERVER_PID=""
WORKER_PID=""

echo "-> npm run golden:driver"
npm run golden:driver

echo "-> npm run golden:snapshot"
npm run golden:snapshot

echo "-> npm run golden:compare"
npm run golden:compare

echo "-> npm run freeze:check"
npm run freeze:check

echo "==> Baseline is GREEN"
