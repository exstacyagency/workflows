import { logError } from "@/lib/logger";
import { JobStatus, JobType } from "@prisma/client";
import type { RuntimeMode } from "@/lib/jobRuntimeMode";
import { cfg } from "@/lib/config";
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
// ...existing code...
import { loadDotEnvFileIfPresent } from "@/lib/config/dotenv";
// ...existing code...
import { runCustomerResearch } from "../services/customerResearchService.ts";
import { runAdRawCollection } from "../lib/adRawCollectionService.ts";
import { runPatternAnalysis } from "../lib/patternAnalysisService.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";
import { startVideoPromptGenerationJob } from "../lib/videoPromptGenerationService.ts";
import { runVideoImageGenerationJob } from "../lib/videoImageGenerationService.ts";
import { runVideoGenerationJob } from "../lib/videoGenerationService.ts";
import prisma from "../lib/prisma.ts";
import { rollbackQuota } from "../lib/billing/usage.ts";
import { getRuntimeMode } from "../lib/jobRuntimeMode";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";

if (cfg.raw("NODE_ENV") !== "production") {
  loadDotEnvFileIfPresent(".env.local");
  loadDotEnvFileIfPresent(".env");
}

type PipelineContext = {
  mode: RuntimeMode;
};

const pipelineContext: PipelineContext = { mode: getRuntimeMode() };

console.log(`[BOOT] Runtime mode: ${pipelineContext.mode}`);
if (pipelineContext.mode === "alpha") {
  console.log("[PIPELINE] Running in ALPHA mode");
}
if (pipelineContext.mode === "alpha" && process.env.NODE_ENV === "production") {
  throw new Error("INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production");
}

const IS_TEST = cfg.raw("NODE_ENV") === "test";

const DEFAULT_POLL_INTERVAL_MS = Number(cfg.raw("WORKER_POLL_MS") ?? 1000);
const TEST_POLL_INTERVAL_MS = Number(cfg.raw("WORKER_TEST_POLL_MS") ?? 50);

const POLL_MS = IS_TEST ? TEST_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS;
const RUN_ONCE = cfg.raw("RUN_ONCE") === "1";
const WORKER_JOB_MAX_RUNTIME_MS = Number(cfg.raw("WORKER_JOB_MAX_RUNTIME_MS") ?? 20 * 60_000);

type JsonObject = Record<string, any>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

async function runWithMaxRuntime<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const timeoutMs = WORKER_JOB_MAX_RUNTIME_MS;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded max runtime ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  return keys.filter((k) => {
    const v = cfg.raw(k);
    return !v || v.trim() === "";
  });
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
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { payload: true, resultSummary: true, status: true },
  });
  if (!existing) return;

  const payload = asObject(existing.payload);
  const data: any = {
    error: null,
    payload: { ...payload, result: serializeResult(result) },
  };
  if (summary !== undefined) data.resultSummary = summary;

  await updateJobStatus(jobId, JobStatus.COMPLETED);
  await prisma.job.update({ where: { id: jobId }, data });
}

async function markFailed(jobId: string, err: unknown) {
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { payload: true, resultSummary: true, status: true },
  });
  if (!existing) return;

  const payload = asObject(existing.payload);
  let errMsg = String((err as any)?.message ?? err);
  let transient = false;
  let provider: string | null = null;
  let rawSnippet: string | null = null;

  const asAny: any = err as any;
  const looksExternal =
    asAny &&
    (asAny.name === "ExternalServiceError" ||
      (typeof asAny.provider === "string" && typeof asAny.retryable === "boolean"));

  if (looksExternal) {
    transient = Boolean(asAny.retryable);
    provider = typeof asAny.provider === "string" ? asAny.provider : null;
    rawSnippet =
      typeof asAny.rawSnippet === "string"
        ? asAny.rawSnippet
        : typeof asAny.raw === "string"
          ? asAny.raw
          : typeof asAny.rawBody === "string"
            ? asAny.rawBody
            : typeof asAny.body === "string"
              ? asAny.body
              : null;
    // Prefer safe message if present
    errMsg = typeof asAny.message === "string" ? asAny.message : errMsg;
  }

  const nextPayload: any = {
    ...payload,
    transient,
    provider,
    lastError: errMsg,
    error: errMsg,
    result: { ok: false, error: errMsg },
  };
  if (rawSnippet) nextPayload.lastErrorRaw = rawSnippet;

  await updateJobStatus(jobId, JobStatus.FAILED);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      error: errMsg,
      resultSummary:
        existing?.resultSummary ??
        (transient
          ? `Transient external failure${provider ? ` (${provider})` : ""}`
          : `Job failed${provider ? ` (${provider})` : ""}`),
      payload: nextPayload,
    },
  });
}

async function appendResultSummary(jobId: string, msg: string) {
  const m = String(msg ?? "").trim();
  if (!m) return;

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { resultSummary: true } });
  const current = String(existing?.resultSummary ?? "").trim();
  if (!current) {
    await prisma.job.update({ where: { id: jobId }, data: { resultSummary: m } });
    return;
  }
  if (current.includes(m)) return;
  await prisma.job.update({ where: { id: jobId }, data: { resultSummary: `${current} | ${m}` } });
}

async function handleProviderConfig(jobId: string, provider: string, requiredEnv: string[]) {
  const missing = envMissing(requiredEnv);
  if (missing.length === 0) return { ok: true as const };

  const reason = `${provider} not configured`;
  if (cfg.raw("CI") === "true") {
    await markCompleted(jobId, { ok: true, skipped: true, reason }, `Skipped: ${reason}`);
    return { ok: false as const, skipped: true as const };
  }

  await markFailed(jobId, reason);
  return { ok: false as const, skipped: false as const };
}

async function claimNextJob() {
  const dueBefore = nowMs();
  const claimed = await prisma.$queryRaw<any[]>`
    UPDATE job
    SET "status" = CAST('RUNNING' AS "JobStatus"),
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM job
      WHERE "status" = CAST('PENDING' AS "JobStatus")
        AND (
          ("payload"->>'nextRunAt') IS NULL
          OR (("payload"->>'nextRunAt')::bigint) <= ${dueBefore}
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "projectId", "userId", "payload", "idempotencyKey", "status";
  `;

  const row = claimed[0];
  if (!row?.id) return null;
  return row as {
    id: string;
    type: JobType;
    projectId: string;
    userId: string;
    payload: unknown;
    idempotencyKey: string | null;
    status: JobStatus;
  };
}

async function runJob(
  job: {
    id: string;
    type: JobType;
    projectId: string;
    userId: string;
    payload: unknown;
    idempotencyKey: string | null;
    status: JobStatus;
  },
  context: PipelineContext,
) {
  const jobId = job.id;
  const payload = asObject(job.payload);

  if (job.status !== JobStatus.RUNNING) {
    throw new Error(`Invalid job state: ${job.status}`);
  }

  if (context.mode === "alpha" && process.env.NODE_ENV === "production") {
    throw new Error("INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production");
  }

  try {
    switch (job.type) {
      case JobType.CUSTOMER_RESEARCH: {
        const apifyToken = cfg.raw("APIFY_TOKEN") ?? cfg.raw("APIFY_API_TOKEN");
        const hasApifyToken = !!apifyToken;
        if (!hasApifyToken) {
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markCompleted(jobId, { ok: true, skipped: true, reason: "Apify not configured" });
          return;
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
        const datasetId = (cfg.raw("APIFY_DATASET_ID") ?? "").trim();
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

        await updateJobStatus(jobId, JobStatus.RUNNING);

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

      case JobType.STORYBOARD_GENERATION: {
        const scriptId = String(payload?.scriptId ?? "").trim();

        try {
          const storyboard = await prisma.storyboard.create({
            data: {
              projectId: job.projectId,
              jobId: job.id,
              scriptId: scriptId || null,
            },
          });

          // Persist reference for downstream jobs
          await prisma.job.update({
            where: { id: job.id },
            data: {
              resultSummary: {
                storyboardId: storyboard.id,
              },
            },
          });

          await markCompleted(jobId, {
            ok: true,
            storyboardId: storyboard.id,
            scriptId: scriptId || null,
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, e);
          await appendResultSummary(jobId, `Storyboard generation failed: ${msg}`);
        }
        return;
      }

      case JobType.VIDEO_PROMPT_GENERATION: {
        const storyboardId = String(payload?.storyboardId ?? "").trim();
        if (!storyboardId) {
          await markFailed(jobId, "Invalid payload: missing storyboardId");
          return;
        }

        const storyboard = await prisma.storyboard.findUnique({
          where: { id: storyboardId },
          select: { id: true, scriptId: true },
        });
        if (!storyboard?.id) {
          await markFailed(jobId, `Storyboard not found for id=${storyboardId}`);
          return;
        }

        const result = await startVideoPromptGenerationJob({ storyboardId, jobId });
        await markCompleted(
          jobId,
          result,
          `Video prompts generated: ${result.processed}/${result.sceneCount} scenes`,
        );

        const chainType = String((payload as any)?.chainNext?.type ?? "");
        const rootKey = String(job.idempotencyKey ?? (payload as any)?.idempotencyKey ?? "").trim();
        if (chainType === "VIDEO_IMAGE_GENERATION" && rootKey) {
          const imageKey = `${rootKey}:images`;
          try {
            await prisma.job.create({
              data: {
                projectId: job.projectId,
                userId: job.userId,
                type: JobType.VIDEO_IMAGE_GENERATION,
                status: JobStatus.PENDING,
                idempotencyKey: imageKey,
                payload: {
                  idempotencyKey: imageKey,
                  storyboardId: storyboard.id,
                  dependsOnJobId: jobId,
                },
              },
            });
          } catch (e: any) {
            const code = String(e?.code ?? "");
            const msg = String(e?.message ?? "");
            const isUnique = code === "P2002" || msg.toLowerCase().includes("unique constraint");
            if (!isUnique) throw e;
          }
          await appendResultSummary(jobId, "Queued video images job");
        }

        return;
      }

      case JobType.VIDEO_IMAGE_GENERATION: {
        const storyboardId = String(payload?.storyboardId ?? "").trim();
        const force = Boolean(payload?.force);
        if (!storyboardId) {
          const msg = "Invalid payload: missing storyboardId";
          await markFailed(jobId, msg);
          await appendResultSummary(jobId, `Video images failed: ${msg}`);
          return;
        }

        const storyboard = await prisma.storyboard.findFirst({
          where: { projectId: job.projectId, id: storyboardId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (!storyboard?.id) {
          const msg = `Storyboard not found for id=${storyboardId}`;
          await markFailed(jobId, msg);
          await appendResultSummary(jobId, `Video images failed: ${msg}`);
          return;
        }

        try {
          await runWithMaxRuntime("VIDEO_IMAGE_GENERATION", async () => {
            await runVideoImageGenerationJob({ jobId });
          });
          await markCompleted(jobId, { ok: true });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, e);
          await appendResultSummary(jobId, `Video images failed: ${msg}`);
        }
        return;
      }

      case JobType.VIDEO_GENERATION: {
        const cfg = await handleProviderConfig(jobId, "KIE", ["KIE_API_KEY"]);
        if (!cfg.ok) {
          if (!cfg.skipped) {
            await appendResultSummary(jobId, "Video generation failed: KIE not configured");
          }
          return;
        }

        const storyboardId = String(payload?.storyboardId ?? "").trim();
        if (!storyboardId) {
          const msg = "Invalid payload: missing storyboardId";
          await markFailed(jobId, msg);
          await appendResultSummary(jobId, `Video generation failed: ${msg}`);
          return;
        }

        try {
          const result = await runVideoGenerationJob(job);
          const firstUrl = result.videoUrls[0] ?? "";
          const summary = result.skipped
            ? `Video generation skipped: ${result.reason ?? "already_generated"}`
            : firstUrl
              ? `Video generated: ${firstUrl}${result.videoUrls.length > 1 ? ` (+${result.videoUrls.length - 1} more)` : ""}`
              : "Video generation completed";
          await markCompleted(jobId, result, summary);
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, e);
          await appendResultSummary(jobId, `Video generation failed: ${msg}`);
        }
        return;
      }

      default: {
        await markFailed(jobId, "Not implemented");
        return;
      }
    }
  } catch (e: any) {
    try {
      await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
      await markFailed(jobId, e);
    } catch (updateErr) {
      console.error("[jobRunner] failed to persist job failure", { jobId, updateErr });
    }
  }
}

async function loop() {
  console.log(`[jobRunner] start poll=${POLL_MS}ms runOnce=${RUN_ONCE} mode=${pipelineContext.mode}`);

  while (true) {
    let job: Awaited<ReturnType<typeof claimNextJob>> | null = null;
    try {
      job = await claimNextJob();
      if (!job) {
        if (RUN_ONCE) return;
        await sleep(POLL_MS);
        continue;
      }

      await runJob(job, pipelineContext);
    } catch (e) {
      logError("job.failed", e, {
        jobId: job?.id ?? null,
        jobType: job?.type ?? null,
        mode: cfg.RUNTIME_MODE,
      });
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
