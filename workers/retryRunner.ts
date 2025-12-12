import { PrismaClient } from "@prisma/client";
import { runWithState } from "../lib/jobRuntime.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";

const prisma = new PrismaClient();

const POLL_MS = Number(process.env.RETRY_POLL_MS ?? 5000);
const BATCH = Number(process.env.RETRY_BATCH ?? 5);
const MAX_WORKER_CONCURRENCY = Number(process.env.MAX_WORKER_CONCURRENCY ?? 2);
const MAX_RUNNING_JOBS_PER_USER = Number(process.env.MAX_RUNNING_JOBS_PER_USER ?? 3);

async function fetchDueScriptGenerationJobIds(nowMs: number) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Job"
    WHERE "type" = CAST('SCRIPT_GENERATION' AS "JobType")
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

async function processOnce() {
  const nowMs = Date.now();
  const ids = await fetchDueScriptGenerationJobIds(nowMs);
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
      return startScriptGenerationJob(job.projectId, job);
    });

    const latest = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, payload: true },
    });
    const p = (latest?.payload as any) ?? {};
    console.log(
      `[retryRunner] job=${jobId} ok=${state.ok} skipped=${(state as any).skipped ?? ""} status=${latest?.status} attempts=${p.attempts ?? 0} nextRunAt=${p.nextRunAt ?? null}`
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
