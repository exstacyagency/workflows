/**
 * Freeze enforcement: ensure buyer-grade docs exist.
 * This is intentionally lightweight and deterministic.
 */

import fs from "node:fs";

const REQUIRED = [
  "docs/SECURITY_AND_DATA_ARCHITECTURE.md",
  "docs/SECURITY_GAPS.md",
  "docs/FREEZE_CONTRACT.md",
];

function main() {
  const missing: string[] = [];
  for (const p of REQUIRED) {
    if (!fs.existsSync(p)) missing.push(p);
  }
  if (missing.length) {
    console.error("FREEZE DOC CHECK FAILED");
    for (const m of missing) console.error(`- missing: ${m}`);
    process.exit(1);
  }
  console.log("freeze:docs OK");
}

main();
