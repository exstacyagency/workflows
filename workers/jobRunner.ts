import { JobStatus, JobType } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

import { runCustomerResearch } from "../services/customerResearchService.ts";
import { runAdRawCollection } from "../lib/adRawCollectionService.ts";
import { runPatternAnalysis } from "../lib/patternAnalysisService.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";
import { startVideoPromptGenerationJob } from "../lib/videoPromptGenerationService.ts";
import { runVideoImageGenerationJob } from "../lib/videoImageGenerationService.ts";
import { runVideoGenerationJob } from "../lib/videoGenerationService.ts";
import prisma from "../lib/prisma.ts";
import { rollbackQuota } from "../lib/billing/usage.ts";

function loadDotEnvFile(filename: string) {
  const filePath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

if (process.env.NODE_ENV !== "production") {
  loadDotEnvFile(".env.local");
  loadDotEnvFile(".env");
}

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
    RETURNING "id", "type", "projectId", "payload", "idempotencyKey";
  `;

  const row = claimed[0];
  if (!row?.id) return null;
  return row as { id: string; type: JobType; projectId: string; payload: unknown; idempotencyKey: string | null };
}

async function runJob(job: { id: string; type: JobType; projectId: string; payload: unknown; idempotencyKey: string | null }) {
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
        const cfg = await handleProviderConfig(jobId, "KIE", ["KIE_API_KEY"]);
        if (!cfg.ok) {
          if (!cfg.skipped) {
            await appendResultSummary(jobId, "Video images failed: KIE not configured");
          }
          return;
        }

        const storyboardId = String(payload?.storyboardId ?? "").trim();
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
          const result = await runVideoImageGenerationJob({ storyboardId: storyboard.id, jobId });
          await markCompleted(
            jobId,
            {
              ok: true,
              storyboardId: result.storyboardId,
              scenesUpdated: result.scenesUpdated,
              firstFrameUrl: result.firstFrameUrl,
              lastFrameUrl: result.lastFrameUrl,
            },
            `Video frames saved: ${result.scenesUpdated}/${result.sceneCount} scenes`,
          );
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, msg);
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
          const result = await runVideoGenerationJob({ storyboardId });
          const firstUrl = result.videoUrls[0] ?? "";
          const summary = firstUrl
            ? `Video generated: ${firstUrl}${result.videoUrls.length > 1 ? ` (+${result.videoUrls.length - 1} more)` : ""}`
            : "Video generation completed";
          await markCompleted(jobId, { ok: true, ...result }, summary);
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded(jobId, job.projectId, payload);
          await markFailed(jobId, msg);
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
