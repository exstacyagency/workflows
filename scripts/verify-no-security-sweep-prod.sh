#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Verifying SECURITY_SWEEP is not present in production configs"

# Files that must NEVER contain SECURITY_SWEEP
FORBIDDEN_PATHS=(
  ".env.production"
  ".env.prod"
  "Dockerfile"
  "docker"
  "infra"
  "terraform"
  ".github/workflows/deploy"
)

FOUND=0

for path in "${FORBIDDEN_PATHS[@]}"; do
  if [ -e "$path" ]; then
    if grep -R "SECURITY_SWEEP" "$path" >/dev/null 2>&1; then
      echo "❌ SECURITY_SWEEP found in $path"
      FOUND=1
    fi
  fi
done

# Also check Vercel / deploy env templates if present
if grep -R "SECURITY_SWEEP" .env* | grep -v ".env.local" >/dev/null 2>&1; then
  echo "❌ SECURITY_SWEEP found in env files"
  FOUND=1
fi

if [ "$FOUND" -eq 1 ]; then
  echo "🚫 SECURITY_SWEEP must NEVER be enabled in production"
  exit 1
fi

echo "✅ SECURITY_SWEEP not present in production configs"
