import { execSync } from "node:child_process";

type Rule = {
  name: string;
  // any changed file matching these globs triggers the rule
  match: RegExp[];
  message: string;
};

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

function getChangedFiles(): string[] {
  // Works in CI after checkout with full history; fallback to git diff --name-only.
  const base = process.env.FREEZE_BASE_REF || "origin/main";
  try {
    sh("git fetch origin main --depth=1");
  } catch {
    // ignore
  }
  const out = sh(`git diff --name-only ${base}...HEAD || true`);
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

function main() {
  const override = process.env.FREEZE_OVERRIDE === "1";
  const files = getChangedFiles();

  const rules: Rule[] = [
    {
      name: "golden-baseline",
      match: [/^e2e\/golden\/baseline\//],
      message:
        "Golden baseline changed. This is a contract bump. Re-run golden locally and set FREEZE_OVERRIDE=1 for a controlled contract update PR.",
    },
    {
      name: "route-manifest",
      match: [/^docs\/ROUTES_MANIFEST\.txt$/],
      message:
        "ROUTES_MANIFEST.txt changed. Ensure routes:check passes and document the change in PR description. This is considered contract-affecting.",
    },
    {
      name: "prisma-migrations-history",
      match: [/^prisma\/migrations\/.*\/migration\.sql$/],
      message:
        "Migration SQL changed. Do not edit historical migrations. Add a new migration instead.",
    },
    {
      name: "api-contract-docs",
      match: [/^docs\/API_CONTRACT\.md$/, /^docs\/FREEZE_CONTRACT\.md$/],
      message:
        "Contract docs changed. Ensure changes are consistent with enforcement scripts and golden baseline.",
    },
  ];

  const violations: string[] = [];
  for (const f of files) {
    for (const r of rules) {
      if (r.match.some((re) => re.test(f))) {
        // migration history edits are always forbidden
        if (r.name === "prisma-migrations-history") {
          violations.push(`[FORBIDDEN] ${r.message} (file: ${f})`);
        } else if (!override && r.name === "golden-baseline") {
          violations.push(`[BLOCKED] ${r.message} (file: ${f})`);
        }
      }
    }
  }

  if (violations.length) {
    console.error("\nFREEZE CHECK FAILED\n");
    for (const v of violations) console.error(`- ${v}`);
    console.error("\nChanged files:\n" + files.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }

  console.log("freeze:check OK");
}

main();
