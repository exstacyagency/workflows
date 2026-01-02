/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const outDir = process.env.GOLDEN_OUT_DIR || "/tmp/golden-output";
const outSummary = path.join(outDir, "summary.json");
if (!fs.existsSync(outSummary)) {
  console.error(`[golden:update-baseline] missing output summary at ${outSummary}`);
  process.exit(1);
}

const baselineDir = path.join("e2e", "golden", "baseline");
const baselineSummary = path.join(baselineDir, "summary.json");
const baselineSha = path.join(baselineDir, "summary.sha256");

copyFile(outSummary, baselineSummary);
const hash = sha256File(baselineSummary);
fs.writeFileSync(baselineSha, `${hash}\n`, "utf8");

console.log(`[golden:update-baseline] updated ${baselineSummary}`);
console.log(`[golden:update-baseline] wrote ${baselineSha}`);
