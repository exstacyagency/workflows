import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const sort = (v: any): any => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(sort);
      const out: any = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2);
}

async function main() {
  const outDir =
    process.argv.includes("--outDir") ? process.argv[process.argv.indexOf("--outDir") + 1] : "e2e/golden/output";
  const projectId =
    process.argv.includes("--projectId") ? process.argv[process.argv.indexOf("--projectId") + 1] : "proj_test";

  fs.mkdirSync(outDir, { recursive: true });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true },
  });

  const users = await prisma.user.findMany({ select: { email: true }, orderBy: { email: "asc" } });

  const counts = {
    jobs: await prisma.job.count({ where: { projectId } }),
    scripts: await prisma.script.count({ where: { projectId } }),
    storyboards: await prisma.storyboard.count({ where: { projectId } }),
    storyboardScenes: await prisma.storyboardScene.count({ where: { storyboard: { projectId } } }),
    researchRows: await prisma.researchRow.count({ where: { projectId } }),
    productIntelligence: await prisma.productIntelligence.count({ where: { projectId } }),
    customerAvatars: await prisma.customerAvatar.count({ where: { projectId } }),
  };

  const jobs = await prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { type: true, status: true, resultSummary: true, error: true, payload: true },
    take: 300,
  });

  const latestByType: Record<string, any> = {};
  for (const j of jobs) {
    const key = String(j.type);
    if (latestByType[key]) continue;
    const p: any = j.payload ?? {};
    latestByType[key] = {
      status: j.status,
      resultSummary: j.resultSummary ?? null,
      error: j.error ?? null,
      skipped: Boolean(p.skipped ?? false),
      reason: p.reason ?? null,
      provider: p.provider ?? null,
      transient: typeof p.transient === "boolean" ? p.transient : null,
      lastError: p.lastError ?? null,
      lastErrorRaw: typeof p.lastErrorRaw === "string" ? p.lastErrorRaw.slice(0, 200) : null,
    };
  }

  const summary = {
    version: 1,
    mode: process.env.SECURITY_SWEEP === "1" ? "deterministic" : "normal",
    project: project ? { id: project.id, name: project.name ?? null } : null,
    users: users.map((u) => u.email),
    counts,
    jobTypesPresent: Object.keys(latestByType).sort(),
    latestByType,
  };

  const json = stableStringify(summary);
  const sha = crypto.createHash("sha256").update(json).digest("hex");

  fs.writeFileSync(path.join(outDir, "summary.json"), json);
  fs.writeFileSync(path.join(outDir, "summary.sha256"), sha + "\n");

  console.log(`[golden] wrote ${outDir}/summary.json`);
  console.log(`[golden] sha256 ${sha}`);
}

main()
  .catch((e) => {
    console.error("[golden] snapshot failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

