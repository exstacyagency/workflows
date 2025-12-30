import fs from "node:fs";
import path from "node:path";
import { buildRouteInventory } from "./route_inventory";

function readLines(p: string): string[] {
  const raw = fs.readFileSync(p, "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith("#"));
}

function main() {
  const manifestPath = path.join(process.cwd(), "docs", "ROUTES_MANIFEST.txt");
  if (!fs.existsSync(manifestPath)) {
    console.error("[routes] Missing docs/ROUTES_MANIFEST.txt");
    process.exit(1);
  }

  const expected = new Set(readLines(manifestPath));
  const actual = buildRouteInventory().map((e) => `${e.method}\t${e.route}\t${e.file}`);

  const missing: string[] = [];
  for (const line of expected) {
    if (!actual.includes(line)) missing.push(line);
  }

  if (missing.length) {
    console.error("[routes] Manifest entries missing from current tree:");
    for (const m of missing.slice(0, 200)) console.error("  - " + m);
    console.error("");
    console.error("If this was intentional, regenerate:");
    console.error("  npm run routes:manifest > docs/ROUTES_MANIFEST.txt");
    process.exit(1);
  }

  console.log("[routes] OK");
}

main();

