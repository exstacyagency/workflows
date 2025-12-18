import { JobStatus, JobType } from "@prisma/client";

import { runCustomerResearch } from "../services/customerResearchService.ts";
import { runAdRawCollection } from "../lib/adRawCollectionService.ts";
import { runPatternAnalysis } from "../lib/patternAnalysisService.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";
import prisma from "../lib/prisma.ts";
import { rollbackQuota } from "../lib/billing/usage.ts";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const RUN_ONCE = process.env.RUN_ONCE === "1";

type JsonObject = Record<string, any>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return {};
}

function serializeResult(value: any) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: false, error: "Result not serializable", value: String(value) };
  }
}

function envMissing(keys: string[]) {
  return keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
}

async function rollbackJobQuotaIfNeeded(jobId: string, projectId: string, payload: JsonObject) {
  const reservation = payload?.quotaReservation;
  if (!reservation || typeof reservation !== "object") return;

  const periodKey = String((reservation as any).periodKey ?? "");
  const metric = String((reservation as any).metric ?? "");
  const amount = Number((reservation as any).amount ?? 0);

  if (!periodKey || !metric || !Number.isFinite(amount) || amount <= 0) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  const userId = project?.userId ?? null;
  if (!userId) return;

  try {
    await rollbackQuota(userId, periodKey, metric as any, amount);
  } catch (e) {
    console.error("[jobRunner] quota rollback failed", { jobId, e });
  }
}

async function markCompleted(jobId: string, result: any, summary?: string) {
  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { payload: true } });
  const payload = asObject(existing?.payload);
  const data: any = {
    status: JobStatus.COMPLETED,
    error: null,
    payload: { ...payload, result: serializeResult(result) },
  };
  if (summary !== undefined) data.resultSummary = summary;
  await prisma.job.update({ where: { id: jobId }, data });
}

async function markFailed(jobId: string, errMsg: string) {
  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { payload: true } });
  const payload = asObject(existing?.payload);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      error: errMsg,
      payload: { ...payload, error: errMsg, result: { ok: false, error: errMsg } },
    },
  });
}

async function handleProviderConfig(jobId: string, provider: string, requiredEnv: string[]) {
  const missing = envMissing(requiredEnv);
  if (missing.length === 0) return { ok: true as const };

  const reason = `${provider} not configured`;
  if (process.env.CI === "true") {
    await markCompleted(jobId, { ok: true, skipped: true, reason }, `Skipped: ${reason}`);
    return { ok: false as const, skipped: true as const };
  }

  await markFailed(jobId, reason);
  return { ok: false as const, skipped: false as const };
}

async function claimNextJob() {
  const dueBefore = nowMs();
  const claimed = await prisma.$queryRaw<any[]>`
    UPDATE "Job"
    SET "status" = CAST('RUNNING' AS "JobStatus"),
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM "Job"
      WHERE "status" = CAST('PENDING' AS "JobStatus")
        AND (
          ("payload"->>'nextRunAt') IS NULL
          OR (("payload"->>'nextRunAt')::bigint) <= ${dueBefore}
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "projectId", "payload";
  `;

  const row = claimed[0];
  if (!row?.id) return null;
  return row as { id: string; type: JobType; projectId: string; payload: unknown };
}

async function runJob(job: { id: string; type: JobType; projectId: string; payload: unknown }) {
  const jobId = job.id;
  const payload = asObject(job.payload);

  try {
    switch (job.type) {
      case JobType.CUSTOMER_RESEARCH: {
        const hasApifyToken = !!process.env.APIFY_TOKEN || !!process.env.APIFY_API_TOKEN;
        if (!hasApifyToken) {
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markCompleted(jobId, { ok: true, skipped: true, reason: "Apify not configured" });
          return;
        }

        if (!process.env.APIFY_TOKEN && process.env.APIFY_API_TOKEN) {
          process.env.APIFY_TOKEN = process.env.APIFY_API_TOKEN;
        }

        const {
          productName,
          productProblemSolved,
          productAmazonAsin,
          competitor1AmazonAsin,
          competitor2AmazonAsin,
        } = payload;

        if (!productName || !productProblemSolved || !productAmazonAsin) {
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, "Invalid payload: missing required customer research fields");
          return;
        }

        const result = await runCustomerResearch({
          projectId: job.projectId,
          jobId,
          productName,
          productProblemSolved,
          productAmazonAsin,
          competitor1AmazonAsin,
          competitor2AmazonAsin,
        });

        await markCompleted(jobId, { ok: true, rows: Array.isArray(result) ? result.length : null });
        return;
      }

      case JobType.AD_PERFORMANCE: {
        const cfgToken = await handleProviderConfig(jobId, "Apify", ["APIFY_API_TOKEN"]);
        if (!cfgToken.ok) return;
        const datasetId = (process.env.APIFY_DATASET_ID ?? "").trim();
        if (!datasetId) {
          const cfgActor = await handleProviderConfig(jobId, "Apify", ["APIFY_ACTOR_ID"]);
          if (!cfgActor.ok) return;
        }

        const { industryCode } = payload;
        if (!industryCode) {
          await markFailed(jobId, "Invalid payload: missing industryCode");
          return;
        }

        const result = await runAdRawCollection({
          projectId: job.projectId,
          industryCode,
          jobId,
        });

        await markCompleted(jobId, { ok: true, apify: result.apify, ads: result.ads }, `Ads: ${result.apify.itemCount}`);
        return;
      }

      case JobType.PATTERN_ANALYSIS: {
        const { customerResearchJobId, adPerformanceJobId } = payload;
        if (!customerResearchJobId || !adPerformanceJobId) {
          await markFailed(jobId, "Invalid payload: missing customerResearchJobId or adPerformanceJobId");
          return;
        }

        await prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.RUNNING },
        });

        const result = await runPatternAnalysis({
          projectId: job.projectId,
          customerResearchJobId: String(customerResearchJobId),
          adPerformanceJobId: String(adPerformanceJobId),
        });

        await markCompleted(jobId, result, `Patterns: ${result.patterns.topHooks.length} hooks`);
        return;
      }

      case JobType.SCRIPT_GENERATION: {
        const cfg = await handleProviderConfig(jobId, "Anthropic", ["ANTHROPIC_API_KEY"]);
        if (!cfg.ok) return;

        const fresh = await prisma.job.findUnique({ where: { id: jobId } });
        if (!fresh) {
          await markFailed(jobId, "Job not found after claim");
          return;
        }

        const result = await startScriptGenerationJob(job.projectId, fresh);
        await markCompleted(jobId, { ok: true, ...result });
        return;
      }

      default: {
        await markFailed(jobId, "Not implemented");
        return;
      }
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "Unknown error");
    try {
      await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
      await markFailed(jobId, msg);
    } catch (updateErr) {
      console.error("[jobRunner] failed to persist job failure", { jobId, updateErr });
    }
  }
}

async function loop() {
  console.log(`[jobRunner] start poll=${POLL_MS}ms runOnce=${RUN_ONCE}`);

  while (true) {
    try {
      const job = await claimNextJob();
      if (!job) {
        if (RUN_ONCE) return;
        await sleep(POLL_MS);
        continue;
      }

      await runJob(job);
    } catch (e) {
      console.error("[jobRunner] loop error", e);
      if (RUN_ONCE) return;
      await sleep(POLL_MS);
    }
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[jobRunner] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[jobRunner] uncaughtException", err);
});

loop()
  .catch((e) => {
    console.error("[jobRunner] fatal", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
