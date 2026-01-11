import { cfg } from "@/lib/config";
import { PrismaClient, JobType } from "@prisma/client";
import { runWithState } from "../lib/jobRuntime.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";
import * as patternSvc from "../lib/adPatternAnalysisService.ts";
import * as transcriptsSvc from "../lib/adTranscriptCollectionService.ts";

const prisma = new PrismaClient();

const POLL_MS = Number(cfg.raw("RETRY_POLL_MS") ?? 5000);
const BATCH = Number(cfg.raw("RETRY_BATCH") ?? 5);
const MAX_WORKER_CONCURRENCY = Number(cfg.raw("MAX_WORKER_CONCURRENCY") ?? 2);
const MAX_RUNNING_JOBS_PER_USER = Number(cfg.raw("MAX_RUNNING_JOBS_PER_USER") ?? 3);
const RUNNING_JOB_TIMEOUT_MS = Number(cfg.raw("RUNNING_JOB_TIMEOUT_MS") ?? 5 * 60_000);
const RUNNING_TIMEOUT_MAX_BATCH = Number(cfg.raw("RUNNING_TIMEOUT_MAX_BATCH") ?? 25);

async function fetchDueJobIds(type: JobType, nowMs: number) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Job"
    WHERE "type" = CAST(${type} AS "JobType")
      AND "status" = CAST('PENDING' AS "JobStatus")
      AND (
        ("payload"->>'nextRunAt') IS NULL
        OR (("payload"->>'nextRunAt')::bigint) <= ${nowMs}
      )
    ORDER BY "updatedAt" ASC
    LIMIT ${BATCH};
  `;
  return rows.map((r) => r.id);
}

async function userRunningCount(userId: string) {
  return prisma.job.count({
    where: {
      status: "RUNNING",
      project: { userId },
    },
  });
}

async function getJobUserId(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { project: { select: { userId: true } } },
  });
  return job?.project.userId ?? null;
}

function resolveFn(mod: any, candidates: string[]) {
  for (const name of candidates) {
    const fn = mod?.[name];
    if (typeof fn === "function") return fn;
  }
  return null;
}

async function callServiceFn(fn: Function, job: any) {
  try {
    return await fn(job.projectId, job);
  } catch {}
  try {
    return await fn(job.projectId);
  } catch {}
  try {
    return await fn(job);
  } catch {}
  return await fn(job.projectId, job.id);
}

async function cleanupStuckRunningJobs() {
  const cutoff = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MS);

  const stuck = await prisma.job.findMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: RUNNING_TIMEOUT_MAX_BATCH,
    select: { id: true, payload: true },
  });

  if (stuck.length === 0) return 0;

  for (const j of stuck) {
    const payload = (j.payload as any) ?? {};
    const attempts = Number(payload.attempts ?? 0) + 1;

    await prisma.job.update({
      where: { id: j.id },
      data: {
        status: "PENDING",
        error: "Worker timeout: stuck RUNNING",
        payload: {
          ...payload,
          attempts,
          nextRunAt: Date.now(),
          lastError: "Worker timeout: stuck RUNNING",
        },
      },
    });
  }

  console.log(`[retryRunner] cleaned stuck RUNNING jobs: ${stuck.length}`);
  return stuck.length;
}

async function processOnce() {
  await cleanupStuckRunningJobs();
  const nowMs = Date.now();
  const scriptIds = await fetchDueJobIds(JobType.SCRIPT_GENERATION, nowMs);
  const patternIds = await fetchDueJobIds(JobType.PATTERN_ANALYSIS, nowMs);
  const transcriptIds = await fetchDueJobIds('AD_TRANSCRIPTS' as any, nowMs);

  const ids = [...scriptIds, ...patternIds, ...transcriptIds];
  if (ids.length === 0) return;

  let executed = 0;
  console.log(`[retryRunner] due=${ids.length} maxTick=${MAX_WORKER_CONCURRENCY}`);
  for (const jobId of ids) {
    if (executed >= MAX_WORKER_CONCURRENCY) {
      console.log(`[retryRunner] stop tick reason=global-cap executed=${executed}`);
      break;
    }

    const userId = await getJobUserId(jobId);
    if (!userId) continue;

    const running = await userRunningCount(userId);
    if (running >= MAX_RUNNING_JOBS_PER_USER) {
      console.log(`[retryRunner] skip job=${jobId} reason=per-user-cap user=${userId}`);
      continue;
    }

    const state = await runWithState(jobId, async () => {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) throw new Error("Job not found");

      if (job.type === JobType.SCRIPT_GENERATION) {
        return startScriptGenerationJob(job.projectId, job);
      }

      if (job.type === JobType.PATTERN_ANALYSIS) {
        const fn =
          resolveFn(patternSvc, [
            "startAdPatternAnalysisJob",
            "runAdPatternAnalysisJob",
            "startPatternAnalysisJob",
            "runPatternAnalysis",
          ]) || null;
        if (!fn) throw new Error("Pattern analysis service function not found");
        return callServiceFn(fn, job);
      }

      if (job.type === ('AD_TRANSCRIPTS' as any)) {
        const fn =
          resolveFn(transcriptsSvc, [
            "startAdTranscriptCollectionJob",
            "runAdTranscriptCollectionJob",
            "startAdTranscriptsJob",
            "runAdTranscripts",
          ]) || null;
        if (!fn) throw new Error("Ad transcripts service function not found");
        return callServiceFn(fn, job);
      }

      throw new Error(`Unsupported job type in retryRunner: ${job.type}`);
    });

    const latest = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, payload: true, type: true, error: true },
    });
    const p = (latest?.payload as any) ?? {};
    console.log(
      `[retryRunner] job=${jobId} type=${latest?.type} ok=${state.ok} skipped=${(state as any).skipped ?? ""} status=${latest?.status} attempts=${p.attempts ?? 0} nextRunAt=${p.nextRunAt ?? null} lastError=${p.lastError ?? null} errorCol=${latest?.error ?? null}`
    );
    executed++;
  }
  console.log(`[retryRunner] tick done executed=${executed}`);
}

async function main() {
  console.log(`[retryRunner] starting poll=${POLL_MS}ms batch=${BATCH}`);
  while (true) {
    try {
      await processOnce();
    } catch (e) {
      console.error("[retryRunner] loop error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
