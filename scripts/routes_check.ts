import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
}

function normalizeLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function main() {
  const expectedPath = "docs/ROUTES_MANIFEST.txt";
  const expected = normalizeLines(readFileSync(expectedPath, "utf8"));

  const actualRaw = sh("npm run -s routes:manifest");
  const actual = normalizeLines(actualRaw);

  const missing: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    const line = expected[i];
    if (!actual.includes(line)) missing.push(line);
  }

  if (missing.length) {
    console.error("routes:check FAILED");
    console.error("Missing expected routes from ROUTES_MANIFEST baseline:");
    for (const m of missing) console.error(`- ${m}`);
    process.exit(1);
  }

  console.log("routes:check OK");
}

main();
