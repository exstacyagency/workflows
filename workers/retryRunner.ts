import { PrismaClient } from "@prisma/client";
import { runWithState } from "../lib/jobRuntime.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";

const prisma = new PrismaClient();

const POLL_MS = Number(process.env.RETRY_POLL_MS ?? 5000);
const BATCH = Number(process.env.RETRY_BATCH ?? 5);

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

async function processOnce() {
  const nowMs = Date.now();
  const ids = await fetchDueScriptGenerationJobIds(nowMs);
  if (ids.length === 0) return;

  for (const jobId of ids) {
    const state = await runWithState(jobId, async () => {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) throw new Error("Job not found");
      return startScriptGenerationJob(job.projectId, job);
    });

    console.log(
      `[retryRunner] job=${jobId} ok=${state.ok} skipped=${(state as any).skipped ?? ""}`
    );
  }
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
