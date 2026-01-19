import { readFileSync } from "fs";
import path from "path";

type GuardCheck = {
  file: string;
  description: string;
  patterns: RegExp[];
};

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function assertPatterns({ file, description, patterns }: GuardCheck) {
  const fullPath = path.join(process.cwd(), file);
  let contents: string;
  try {
    contents = readFileSync(fullPath, "utf8");
  } catch (err) {
    fail(`${description} → cannot read ${file}: ${String(err)}`);
  }

  patterns.forEach((regex) => {
    if (!regex.test(contents)) {
      fail(`${description} → missing pattern ${regex} in ${file}`);
    }
  });

  console.log(`✔ ${description}`);
}

function main() {
  const checks: GuardCheck[] = [
    {
      file: "app/api/e2e/reset/route.ts",
      description: "POST /api/e2e/reset 404 in production",
      patterns: [
        /Not Found"\s*,\s*\{\s*status:\s*404\s*\}/,
      ],
    },
    {
      file: "app/api/debug/whoami/route.ts",
      description: "GET /api/debug/whoami disabled in production",
      patterns: [
        /cfg\.raw\("NODE_ENV"\)\s*===\s*"production"[\s\S]*status:\s*404/,
      ],
    },
    {
      file: "app/api/debug/mint-session/route.ts",
      description: "POST /api/debug/mint-session disabled outside SaaS",
      patterns: [
        /isSelfHosted\(\)\)\s*\{\s*return NextResponse\.json\(\{\s*error: "Not found"/,
      ],
    },
    {
      file: "app/api/debug/clear-auth-throttle/route.ts",
      description: "POST /api/debug/clear-auth-throttle disabled outside SaaS",
      patterns: [
        /isSelfHosted\(\)\)\s*\{\s*return NextResponse\.json\(\{\s*error: "Not found"/,
      ],
    },
    {
      file: "app/api/health/route.ts",
      description: "GET /api/health remains public",
      patterns: [
        /NextResponse\.json\([\s\S]*status:\s*200/,
      ],
    },
  ];

  checks.forEach(assertPatterns);
  console.log("✅ Production guardrails verified");
}

main();
