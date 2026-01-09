#!/usr/bin/env bash
set -euo pipefail

# Smoke suite for membership gating + SECURITY_SWEEP behavior + quota enforcement.
#
# Supports arbitrary endpoint sets + per-endpoint payload extras via env vars:
#   ENDPOINTS="/api/jobs/ad-transcripts /api/jobs/customer-analysis /api/jobs/ad-performance"
#   QUOTA_ENDPOINT="/api/jobs/ad-performance"
#   PAYLOAD_EXTRA_JSON='{"industryCode":"retail"}'
#
# For other job types, override payload extras as needed:
#   PAYLOAD_EXTRA_JSON='{"industryCode":"retail","someOtherField":"x"}'
#
# Usage:
#   BASE=http://localhost:3000 PROJECT_ID=<uuid> ./smoke_membership.sh

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing command: $1"; exit 1; }; }

BASE="${BASE:-http://localhost:3000}"
PROJECT_ID="${PROJECT_ID:-}"
EMAIL="${EMAIL:-attacker@local.dev}"
PASSWORD="${PASSWORD:-Attacker123}"
COOKIEJAR="${COOKIEJAR:-/tmp/nacookie}"

# Default endpoint set (already validated)
ENDPOINTS="${ENDPOINTS:-/api/jobs/ad-transcripts /api/jobs/customer-analysis /api/jobs/ad-performance}"
QUOTA_ENDPOINT="${QUOTA_ENDPOINT:-/api/jobs/ad-performance}"

# JSON object merged into payload for ALL endpoints.
# Keep this minimal and override per run.
PAYLOAD_EXTRA_JSON="${PAYLOAD_EXTRA_JSON:-{\"industryCode\":\"retail\"}}"

# If a subset needs different extras, you can override with per-endpoint vars:
#   PAYLOAD_EXTRA_JSON__api_jobs_customer_research='{"industryCode":"retail","productProblemSolved":"x"}'
# Naming rule: replace "/" with "_" and "-" with "_" and prefix PAYLOAD_EXTRA_JSON
# Example key for /api/jobs/customer-research:
#   PAYLOAD_EXTRA_JSON__api_jobs_customer_research

norm_key() { echo "$1" | sed 's#/#_#g; s#-#_#g'; }

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: PROJECT_ID is required. Example:"
  echo "  export PROJECT_ID=f966c0e6-b4cf-42fb-b805-19e6d41350b7"
  exit 1
fi

need_cmd curl
need_cmd node
need_cmd base64

http_code() {
  curl -s -o /dev/null -w "%{http_code}\n" "$1" || true
}

server_check() {
  local code
  code="$(http_code "$BASE/api/auth/session")"
  [[ "$code" == "200" ]] || { echo "ERROR: server not responding at $BASE (got $code)"; exit 1; }
}

session_json() { curl -s -b "$COOKIEJAR" "$BASE/api/auth/session" || true; }

is_logged_in() {
  local s
  s="$(session_json)"
  echo "$s" | grep -q "\"email\":\"$EMAIL\""
}

merge_payload() {
  # Robust merge: pass JSON via stdin/base64 so shells can't corrupt it.
  local base_json="$1"
  local extra_json="$2"

  local base_b64 extra_b64
  base_b64="$(printf '%s' "$base_json" | base64 | tr -d '\n')"
  extra_b64="$(printf '%s' "$extra_json" | base64 | tr -d '\n')"

  node - <<'EOFNODE' "$base_b64" "$extra_b64"
const base = Buffer.from(process.argv[1], "base64").toString("utf8");
const extra = Buffer.from(process.argv[2], "base64").toString("utf8");
const out = { ...JSON.parse(base), ...JSON.parse(extra || "{}") };
process.stdout.write(JSON.stringify(out));
EOFNODE
}

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

set_free() {
  EMAIL="$EMAIL" node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const email = process.env.EMAIL;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true }});
  if (!u) throw new Error(`User not found: ${email}`);
  await prisma.subscription.deleteMany({ where: { userId: u.id }});
  console.log('attacker FREE');
  await prisma.$disconnect();
})().catch(e=>{ console.error(e); process.exit(1); });
EOFNODE
}

set_growth() {
  EMAIL="$EMAIL" node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const email = process.env.EMAIL;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true }});
  if (!u) throw new Error(`User not found: ${email}`);
  await prisma.subscription.upsert({
    where: { userId: u.id },
    update: { planId: 'GROWTH', status: 'active' },
    create: { userId: u.id, planId: 'GROWTH', status: 'active' },
  });
  console.log('attacker GROWTH');
  await prisma.$disconnect();
})().catch(e=>{ console.error(e); process.exit(1); });
EOFNODE
}

reset_usage() {
  EMAIL="$EMAIL" node - <<'EOFNODE'
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const email = process.env.EMAIL;
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true }});
  if (!u) throw new Error(`User not found: ${email}`);
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  await prisma.usage.updateMany({
    where: { userId: u.id, period: start },
    data: { jobsUsed: 0, videoJobsUsed: 0, tokensUsed: 0 },
  });
  console.log('usage reset');
  await prisma.$disconnect();
})().catch(e=>{ console.error(e); process.exit(1); });
EOFNODE
}

mk_payload() {
  local prompt="$1"
  local base extra key varname

  # Base payload matches your validated research schema family.
  base="$(cat <<EOFJSON
{
  "projectId":"$PROJECT_ID",
  "prompt":"$prompt",
  "productName":"Test Product v2",
  "productProblemSolved":"Smoke test",
  "productAmazonAsin":"B000000000"
}
EOFJSON
)"

  # Global extras
  extra="$PAYLOAD_EXTRA_JSON"

  # Optional per-endpoint extras are applied by caller via mk_payload_for_endpoint
  echo "$(merge_payload "$base" "$extra")"
}

mk_payload_for_endpoint() {
  local ep="$1"
  local prompt="$2"
  local base payload extra key varname per_ep

  payload="$(mk_payload "$prompt")"

  key="$(norm_key "$ep")"
  varname="PAYLOAD_EXTRA_JSON__${key}"
  per_ep="${!varname-}"

  if [[ -n "${per_ep}" ]]; then
    echo "$(merge_payload "$payload" "$per_ep")"
  else
    echo "$payload"
  fi
}

call_code() {
  curl -s -o /dev/null -w "%{http_code}\n" -b "$COOKIEJAR" \
    -H "Content-Type: application/json" \
    -X POST "$BASE$1" -d "$2"
}

call_body() {
  curl -s -b "$COOKIEJAR" \
    -H "Content-Type: application/json" \
    -X POST "$BASE$1" -d "$2"
}

free_test() {
  local ts fail=0
  ts="$(date +%s)"
  for ep in $ENDPOINTS; do
    local payload code
    payload="$(mk_payload_for_endpoint "$ep" "free-test-$ep-$ts")"
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
  local ts fail=0
  ts="$(date +%s)"
  for ep in $ENDPOINTS; do
    local payload code body
    payload="$(mk_payload_for_endpoint "$ep" "growth-test-$ep-$ts")"
    code="$(call_code "$ep" "$payload")"
    body="$(call_body "$ep" "$payload")"
    if [[ "$code" != "200" ]]; then
      echo "FAIL GROWTH: $ep expected 200, got $code"
      echo "$body"
      fail=1
      continue
    fi
    echo "$body" | grep -q '"skipped":true' || { echo "FAIL GROWTH: $ep missing skipped:true"; echo "$body"; fail=1; }
    [[ $fail -eq 0 ]] && echo "PASS GROWTH: $ep => 200 (skipped)"
  done
  return $fail
}

quota_test() {
  local ep="$QUOTA_ENDPOINT"
  echo "Quota test on $ep (200 x10 then 429 on 11)"
  local ok=1
  for i in $(seq 1 11); do
    local payload code
    payload="$(mk_payload_for_endpoint "$ep" "quota-$ep-$i-$(date +%s)")"
    code="$(call_code "$ep" "$payload")"
    echo "  $i => $code"
    [[ "$i" -le 10 && "$code" != "200" ]] && ok=0
    [[ "$i" -eq 11 && "$code" != "429" ]] && ok=0
  done
  [[ "$ok" -eq 1 ]] || { echo "FAIL QUOTA"; return 1; }
  echo "PASS QUOTA"
}

main() {
  server_check
  if ! is_logged_in; then login; else echo "Already logged in as $EMAIL."; fi

  echo "=== FREE gate test ==="
  set_free
  free_test

  echo "=== GROWTH allow test (SECURITY_SWEEP) ==="
  set_growth
  # IMPORTANT: researchQueries quota is shared across endpoints and can be left exhausted
  # from prior runs. Reset before the allow test so 429 doesn't mask 200+skipped behavior.
  reset_usage
  growth_test

  echo "=== QUOTA test ==="
  reset_usage
  quota_test

  echo "ALL TESTS PASSED."
}

main
