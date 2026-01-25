#!/usr/bin/env bash
set -euo pipefail

echo "== Test #2: Self-operator auth & isolation =="

API_URL=${API_URL:-http://localhost:3000}


echo "→ Creating User A"
USER_A_JSON=$(curl -s -X POST "$API_URL/internal/test/create-user" \
  -H "Content-Type: application/json" \
  -d '{"email":"a@test.local"}')
USER_A_TOKEN=$(echo "$USER_A_JSON" | jq -r .token)
USER_A_PROJECT_ID=$(echo "$USER_A_JSON" | jq -r .projectId)

echo "→ Creating User B"
USER_B_JSON=$(curl -s -X POST "$API_URL/internal/test/create-user" \
  -H "Content-Type: application/json" \
  -d '{"email":"b@test.local"}')
USER_B_TOKEN=$(echo "$USER_B_JSON" | jq -r .token)
USER_B_PROJECT_ID=$(echo "$USER_B_JSON" | jq -r .projectId)

echo "→ User A creates job"
JOB_RESPONSE=$(curl -s -X POST "$API_URL/api/jobs" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$USER_A_PROJECT_ID'",
    "pipeline": "SCRIPT_GENERATION",
    "idempotencyKey": "test-auth-iso-job-1",
    "input": {"test": true}
  }')
echo "Job creation response: $JOB_RESPONSE"
JOB_ID=$(echo "$JOB_RESPONSE" | jq -r .id)

echo "→ User B attempts to access User A job"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  "$API_URL/api/jobs/$JOB_ID")

if [ "$STATUS" -ne 404 ] && [ "$STATUS" -ne 403 ]; then
  echo "❌ Isolation failure: User B accessed User A job"
  exit 1
fi

echo "→ User B attempts retry on User A job"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  "$API_URL/api/jobs/$JOB_ID/retry")

if [ "$STATUS" -ne 404 ] && [ "$STATUS" -ne 403 ]; then
  echo "❌ Isolation failure: User B retried User A job"
  exit 1
fi

echo "✅ Test #2 passed"
