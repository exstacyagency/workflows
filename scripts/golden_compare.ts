import fs from "node:fs";
import path from "node:path";

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function stable(obj: any) {
  // scrub any accidental volatile fields in the future
  const clone = JSON.parse(JSON.stringify(obj));
  return clone;
}

function die(msg: string): never {
  console.error("[golden] FAIL:", msg);
  process.exit(1);
}

function main() {
  const outPath =
    process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "e2e/golden/output/summary.json";
  const baselinePath =
    process.argv.includes("--baseline")
      ? process.argv[process.argv.indexOf("--baseline") + 1]
      : "e2e/golden/baseline/summary.json";

  const outAbs = path.resolve(outPath);
  const baseAbs = path.resolve(baselinePath);

  if (!fs.existsSync(outAbs)) die(`missing snapshot: ${outAbs}`);

  const snap = stable(readJson(outAbs));

  // Always-enforced invariants
  if (!snap.project || snap.project.id !== "proj_test") die("expected project.id=proj_test");
  if (!snap.counts || typeof snap.counts.jobs !== "number" || snap.counts.jobs < 1) die("expected counts.jobs >= 1");
  if (!Array.isArray(snap.users) || snap.users.length < 1) die("expected users[]");

  // Optional strict baseline
  if (fs.existsSync(baseAbs)) {
    const base = stable(readJson(baseAbs));
    const baseIsNoteOnly = typeof base?.note === "string" && Object.keys(base).length === 1;
    if (!baseIsNoteOnly) {
      const a = JSON.stringify(base);
      const b = JSON.stringify(snap);
      if (a !== b) {
        die(
          `snapshot differs from baseline\n` +
            `baseline=${baselinePath}\n` +
            `snapshot=${outPath}\n` +
            `To intentionally update baseline:\n` +
            `  cp ${outPath} ${baselinePath} && git add ${baselinePath} && git commit -m "chore(golden): update baseline"`,
        );
      }
    }
  }

  console.log("[golden] OK");
}

main();

