import { execSync } from "node:child_process";
import * as fs from "node:fs";

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

function readEvent(): any | null {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function getShas(): { base: string; head: string } {
  const ev = readEvent();
  const base = ev?.pull_request?.base?.sha;
  const head = ev?.pull_request?.head?.sha;
  if (typeof base === "string" && typeof head === "string") return { base, head };

  try {
    const headSha = sh("git rev-parse HEAD");
    const baseSha = sh("git rev-parse origin/main");
    return { base: baseSha, head: headSha };
  } catch {
    return { base: "origin/main", head: "HEAD" };
  }
}

function isContractPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  if (norm.startsWith("e2e/golden/baseline/")) return true;
  if (norm === "docs/FREEZE_CONTRACT.md") return true;
  if (norm === "docs/API_CONTRACT.md") return true;
  if (norm === "docs/CONTRACT_BUMP.md") return true;
  return false;
}

function main() {
  const override = process.env.FREEZE_OVERRIDE === "1";
  const { base, head } = getShas();

  let files: string[] = [];
  try {
    const out = sh(`git diff --name-only ${base} ${head}`);
    files = out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    const out = sh("git diff --name-only origin/main...HEAD");
    files = out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  }

  const contractTouched = files.filter(isContractPath);
  if (contractTouched.length === 0) {
    console.log("[contract] OK (no contract paths changed)");
    return;
  }

  if (!override) {
    console.error("CONTRACT BUMP BLOCKED");
    console.error("Contract paths changed but FREEZE_OVERRIDE!=1.");
    console.error("Changed contract files:");
    for (const f of contractTouched) console.error(` - ${f}`);
    console.error("");
    console.error("If this is intentional, re-run golden and open a controlled contract bump PR with FREEZE_OVERRIDE=1.");
    process.exit(1);
  }

  console.log("[contract] OK (override enabled)");
  console.log("Contract paths changed:");
  for (const f of contractTouched) console.log(` - ${f}`);
}

main();
