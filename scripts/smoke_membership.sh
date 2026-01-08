#!/usr/bin/env bash
set -euo pipefail

# Endpoint-aware payload base builder
need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing $1"; exit 1; }; }
need curl
need node

usage() {
  cat <<'EOF'
Usage:
  scripts/smoke_membership.sh \
    --base http://localhost:3000 \
    --project-id <PROJECT_UUID> \
    --email attacker@local.dev \
    --password Attacker123 \
    --endpoints "/api/jobs/customer-research" \
    --quota-endpoint "/api/jobs/customer-research" \
    --extra-json '{}'

Notes:
  - This script logs in if cookie jar is missing/invalid.
  - It toggles FREE/GROWTH + resets usage via Prisma.
  - If Prisma cannot connect, it fails fast with the Prisma error.
EOF
}

BASE="http://localhost:3000"
PROJECT_ID=""
EMAIL="attacker@local.dev"
PASSWORD="Attacker123"
COOKIEJAR="/tmp/nacookie"
PLAN="GROWTH"
QUOTA_LIMIT=10
ENDPOINTS=""
QUOTA_ENDPOINT=""
EXTRA_JSON="{}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --project-id) PROJECT_ID="$2"; shift 2;;
    --email) EMAIL="$2"; shift 2;;
    --password) PASSWORD="$2"; shift 2;;
    --plan) PLAN="$2"; shift 2;;
    --quota-limit) QUOTA_LIMIT="$2"; shift 2;;
    --cookiejar) COOKIEJAR="$2"; shift 2;;
    --endpoints) ENDPOINTS="$2"; shift 2;;
    --quota-endpoint) QUOTA_ENDPOINT="$2"; shift 2;;
    --extra-json) EXTRA_JSON="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

if ! [[ "$QUOTA_LIMIT" =~ ^[0-9]+$ ]] || [[ "$QUOTA_LIMIT" -lt 0 ]]; then
  echo "ERROR: --quota-limit must be a non-negative integer (got: $QUOTA_LIMIT)"
  exit 1
fi

[[ -n "$PROJECT_ID" ]] || { echo "ERROR: --project-id required"; exit 1; }
[[ -n "$ENDPOINTS" ]] || { echo "ERROR: --endpoints required"; exit 1; }
[[ -n "$QUOTA_ENDPOINT" ]] || { echo "ERROR: --quota-endpoint required"; exit 1; }

# Validate EXTRA_JSON now (no surprises later)
node -e "JSON.parse(process.argv[1])" "$EXTRA_JSON" >/dev/null 2>&1 || {
  echo "ERROR: --extra-json is not valid JSON"
  echo "Got: $EXTRA_JSON"
  exit 1
}

http_code() { curl -s -o /dev/null -w "%{http_code}\n" "$1" || true; }

server_check() {
  local code
  code="$(http_code "$BASE/api/auth/session")"
  [[ "$code" == "200" ]] || { echo "ERROR: server not responding at $BASE (got $code)"; exit 1; }
}

session_json() { curl -s -b "$COOKIEJAR" "$BASE/api/auth/session" || true; }
is_logged_in() { session_json | grep -q "\"email\":\"$EMAIL\""; }

login() {
  echo "Logging in as $EMAIL ..."
  rm -f "$COOKIEJAR"
  local csrf
  csrf="$(curl -s -c "$COOKIEJAR" "$BASE/api/auth/csrf" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).csrfToken))")"
  set +H || true
  curl -s -i \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    "$BASE/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$csrf" \
    --data-urlencode "email=$EMAIL" \
    --data-urlencode "password=$PASSWORD" \
    -b "$COOKIEJAR" -c "$COOKIEJAR" >/dev/null
  is_logged_in || { echo "ERROR: login failed"; session_json; echo; exit 1; }
  echo "Login OK."
}

base_payload_for_endpoint() {
  # Return a JSON object (as string) for the endpoint-specific minimum body.
  # Extra JSON will be merged on top.
  local ep="$1"
  local prompt="$2"
  node - "$ep" "$PROJECT_ID" "$prompt" <<'EOFNODE'
const ep = process.argv[2];
const projectId = process.argv[3];
const prompt = process.argv[4];

// Default base payload (research-style jobs)
let base = {
  projectId,
  prompt,
  productName: "Test Product v2",
  productProblemSolved: "Smoke test",
  productAmazonAsin: "B000000000",
};

// Endpoint-specific overrides:
if (ep === "/api/jobs/storyboard-generation") {
  // storyboard-generation only accepts projectId + optional scriptId
  base = { projectId };
}
if (ep === "/api/jobs/video-prompts") {
  // video-prompts only accepts storyboardId (extra-json must supply it)
  base = {};
}
if (ep === "/api/jobs/video-upscaler") {
  // video-upscaler requires storyboardId (extra-json must supply it)
  base = {};
}
// For other endpoints, keep default base and add required extras via --extra-json.

process.stdout.write(JSON.stringify(base));
EOFNODE
}

mk_payload() {
  local prompt="$1"
  local ep="${CURRENT_ENDPOINT:-}"
  [[ -n "$ep" ]] || { echo "ERROR: CURRENT_ENDPOINT not set"; exit 1; }

  local base_json
  base_json="$(base_payload_for_endpoint "$ep" "$prompt")"

  node - "$base_json" "$EXTRA_JSON" <<'EOFNODE'
const baseJson = process.argv[2];
const extraJson = process.argv[3] || "{}";
let extra = {};
try { extra = JSON.parse(extraJson); } catch (e) {
  console.error("Invalid --extra-json:", extraJson);
  process.exit(1);
}
const base = JSON.parse(baseJson);
process.stdout.write(JSON.stringify({ ...base, ...extra }));
EOFNODE
}

call_code() {
  local path="$1" payload="$2"
  curl -s -o /dev/null -w "%{http_code}\n" -b "$COOKIEJAR" \
    -H "Content-Type: application/json" \
    -X POST "$BASE$path" -d "$payload"
}

call_body() {
  local path="$1" payload="$2"
  curl -s -b "$COOKIEJAR" -H "Content-Type: application/json" -X POST "$BASE$path" -d "$payload"
}

prisma_exec() {
  # Fail fast if Prisma can't connect. This avoids silent partial runs.
  node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    const email = process.env.EMAIL;
    const action = process.env.PRISMA_ACTION;
    const plan = process.env.PLAN || "GROWTH";
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true }});
    if (!u) throw new Error(`User not found: ${email}`);

    if (action === "free") {
      await prisma.subscription.deleteMany({ where: { userId: u.id }});
      console.log("attacker FREE");
      return;
    }
    if (action === "growth") {
      await prisma.subscription.upsert({
        where: { userId: u.id },
        update: { planId: plan, status: 'active' },
        create: { userId: u.id, planId: plan, status: 'active' },
      });
      console.log(`attacker ${plan}`);
      return;
    }
    if (action === "reset_usage") {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      await prisma.usage.updateMany({
        where: { userId: u.id, period: start },
        data: { jobsUsed: 0, videoJobsUsed: 0, tokensUsed: 0 },
      });
      console.log("usage reset");
      return;
    }
    throw new Error(`Unknown action: ${action}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
EOFNODE
}

prisma_clear_idempotency() {
  # Smoke-only: delete all jobs for this project to avoid idempotency reuse.
  # This is intentionally blunt; smoke tests are not preserving historical jobs.
  PROJECT_ID="$PROJECT_ID" EMAIL="$EMAIL" node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    const email = process.env.EMAIL;
    const projectId = process.env.PROJECT_ID;
    if (!email || !projectId) return;

    // Ensure project belongs to user (avoid deleting someone else's jobs)
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true }});
    if (!u) return;
    const p = await prisma.project.findFirst({ where: { id: projectId, userId: u.id }, select: { id: true }});
    if (!p) return;

    const before = await prisma.job.count({ where: { projectId } });
    const res = await prisma.job.deleteMany({ where: { projectId } });
    const after = await prisma.job.count({ where: { projectId } });
    console.log(`[idempotency-clear] projectId=${projectId} before=${before} deleted=${res.count} after=${after}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
EOFNODE
}

free_test() {
  echo "=== FREE gate test ==="
  EMAIL="$EMAIL" PRISMA_ACTION=free prisma_exec
  local ts fail=0
  ts="$(date +%s)"
  for ep in $ENDPOINTS; do
    export CURRENT_ENDPOINT="$ep"
    local payload code
    payload="$(mk_payload "free-test-$ep-$ts")"
    code="$(call_code "$ep" "$payload")"
    if [[ "$code" != "402" ]]; then
      echo "FAIL FREE: $ep expected 402, got $code"
      call_body "$ep" "$payload"; echo
      fail=1
    else
      echo "PASS FREE: $ep => 402"
    fi
  done
  return $fail
}

growth_test() {
  echo "=== GROWTH allow test (SECURITY_SWEEP) ==="
  EMAIL="$EMAIL" PRISMA_ACTION=growth PLAN="$PLAN" prisma_exec
  EMAIL="$EMAIL" PRISMA_ACTION=reset_usage prisma_exec
  local ts fail=0
  ts="$(date +%s)"
  for ep in $ENDPOINTS; do
    export CURRENT_ENDPOINT="$ep"
    prisma_clear_idempotency "$ep"
    local payload code body
    payload="$(mk_payload "growth-test-$ep-$ts")"
    code="$(call_code "$ep" "$payload")"
    body="$(call_body "$ep" "$payload")"
    if [[ "$code" != "200" ]]; then
      echo "FAIL GROWTH: $ep expected 200, got $code"
      echo "$body"
      fail=1
      continue
    fi
    # Some endpoints still do deterministic work during SECURITY_SWEEP and return ok:true instead of skipped:true.
    # Accept either success shape.
    if echo "$body" | grep -q '"skipped":true'; then
      [[ $fail -eq 0 ]] && echo "PASS GROWTH: $ep => 200 (skipped)"
    elif echo "$body" | grep -q '"ok":true'; then
      [[ $fail -eq 0 ]] && echo "PASS GROWTH: $ep => 200 (ok)"
    else
      echo "FAIL GROWTH: $ep expected skipped:true or ok:true"; echo "$body"; fail=1
    fi
  done
  return $fail
}

quota_test() {
  echo "=== QUOTA test ==="
  EMAIL="$EMAIL" PRISMA_ACTION=reset_usage prisma_exec
  local expect_429_at=$((QUOTA_LIMIT + 1))
  echo "Quota test on $QUOTA_ENDPOINT (expect 200 x$QUOTA_LIMIT then 429 on $expect_429_at)"
  local ok=1
  for i in $(seq 1 "$expect_429_at"); do
    export CURRENT_ENDPOINT="$QUOTA_ENDPOINT"
    prisma_clear_idempotency "$QUOTA_ENDPOINT"
    local payload code
    payload="$(mk_payload "quota-$QUOTA_ENDPOINT-$i-$(date +%s)")"
    code="$(call_code "$QUOTA_ENDPOINT" "$payload")"
    echo "  $i => $code"
    if [[ "$i" -le "$QUOTA_LIMIT" ]]; then
      [[ "$code" != "200" ]] && ok=0
    else
      [[ "$code" != "429" ]] && ok=0
    fi
  done
  [[ "$ok" -eq 1 ]] || { echo "FAIL QUOTA"; return 1; }
  echo "PASS QUOTA"
}

main() {
  server_check
  if ! is_logged_in; then login; else echo "Already logged in as $EMAIL."; fi
  PRISMA_ACTION=free EMAIL="$EMAIL" prisma_exec; free_test
  growth_test
  quota_test
  echo "ALL TESTS PASSED."
}

main
