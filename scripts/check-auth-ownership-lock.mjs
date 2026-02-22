#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    failures.push(`Missing file: ${relPath}`);
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

function expectMatch(name, text, re) {
  if (!re.test(text)) failures.push(`❌ ${name}`);
}

function expectNoMatch(name, text, re) {
  if (re.test(text)) failures.push(`❌ ${name}`);
}

// 1) lib/requireProjectOwner.ts
{
  const f = read("lib/requireProjectOwner.ts");
  expectMatch(
    "requireProjectOwner should hard-fail unauthenticated (401)",
    f,
    /if\s*\(!userId\)\s*return\s*{[^}]*status:\s*401[^}]*}/s
  );
  expectMatch(
    "requireProjectOwner should enforce ownership (project id + userId)",
    f,
    /where:\s*{(?=[^}]*\bid:\s*projectId)(?=[^}]*\buserId\b)[^}]*}/s
  );
  expectNoMatch(
    "requireProjectOwner should not contain mode bypass (isTestMode / Allow bypass)",
    f,
    /isTestMode|Allow bypass|security sweep/i
  );
}

// 2) app/api/jobs/ad-performance/route.ts
{
  const f = read("app/api/jobs/ad-performance/route.ts");
  expectMatch(
    "ad-performance route should import requireProjectOwner",
    f,
    /from\s+["']@\/lib\/requireProjectOwner["']/
  );
  expectMatch(
    "ad-performance route should call requireProjectOwner(projectId)",
    f,
    /requireProjectOwner\s*\(\s*projectId\s*\)/
  );
  expectMatch(
    "ad-performance idempotency lookup should be scoped by idempotencyKey + projectId + userId",
    f,
    /where:\s*{(?=[^}]*\bidempotencyKey\b)(?=[^}]*\bprojectId\b)(?=[^}]*\buserId\b)[^}]*}/s
  );
}

// 3) app/api/dev/enqueue-customer-research/route.ts
{
  const f = read("app/api/dev/enqueue-customer-research/route.ts");
  expectMatch(
    "dev enqueue route should require explicit projectId (400 when missing)",
    f,
    /if\s*\(!projectId\)\s*{[\s\S]*status:\s*400/s
  );
  expectNoMatch(
    "dev enqueue route should not default projectId to proj_test",
    f,
    /\?\?\s*["']proj_test["']/
  );
  expectNoMatch(
    "dev enqueue route should not upsert/create project automatically",
    f,
    /project\.upsert\s*\(/s
  );
  expectMatch(
    "dev enqueue route should verify owned existing project (id + userId)",
    f,
    /findFirst\(\s*{[\s\S]*where:\s*{(?=[\s\S]*\bid:\s*projectId)(?=[\s\S]*\buserId\b)[\s\S]*}\s*,?[\s\S]*}\s*\)/s
  );
}

// 4) app/api/projects/route.ts
{
  const f = read("app/api/projects/route.ts");
  expectNoMatch(
    "projects route should not use random test fallback identity",
    f,
    /randomBytes|test_session|cfg\.isDev|cfg\.MODE\s*===\s*["']test["']|cfg\.MODE\s*===\s*["']beta["']/s
  );
  const unauthorizedCount = (f.match(/Unauthorized/g) || []).length;
  if (unauthorizedCount < 2) {
    failures.push("❌ projects route should return Unauthorized in both GET and POST when session missing");
  }
}

if (failures.length > 0) {
  console.error("AUTH OWNERSHIP LOCK CHECK FAILED");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log("✅ AUTH OWNERSHIP LOCK CHECK PASSED");
process.exit(0);
