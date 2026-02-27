import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const cwd = process.cwd();
const envLocal = path.join(cwd, ".env.local");
const env = path.join(cwd, ".env");

if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
if (fs.existsSync(env)) dotenv.config({ path: env });

import { assertRuntimeMode } from "../lib/jobRuntimeMode";
import { logError } from "@/lib/logger";
import { JobStatus, JobType, Prisma, RunStatus } from "@prisma/client";
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
// ...existing code...
import { runCustomerResearch } from "../services/customerResearchService.ts";
import { runCustomerAnalysis } from "../lib/customerAnalysisService";
import { collectAds, buildAdCollectionConfig, type AdCollectionConfig } from "../lib/adRawCollectionService.ts";
import { runAdOcrCollection } from "../lib/adOcrCollectionService.ts";
import { runAdTranscriptCollection } from "../lib/adTranscriptCollectionService.ts";
import { runAdQualityGate } from "../lib/adQualityGateService.ts";
import { runPatternAnalysis } from "../lib/patternAnalysisService.ts";
import { startScriptGenerationJob } from "../lib/scriptGenerationService.ts";
import { generateStoryboard } from "../lib/storyboardGenerationService.ts";
import { startVideoPromptGenerationJob } from "../lib/videoPromptGenerationService.ts";
import { runVideoImageGenerationJob } from "../lib/videoImageGenerationService.ts";
import { generateCreatorAvatar } from "../lib/creatorAvatarGenerationService.ts";
import {
  createCharacterAvatarImage,
  extractImageUrl,
  getTask,
  normalizeState as normalizeKieState,
} from "../lib/kieCharacterService.ts";
import {
  getProductCharacterState,
  saveCreatorVisualPrompt,
  saveCharacterAvatarImage,
  saveCharacterToTable,
} from "../lib/productCharacterStore.ts";
// ARCHIVED: IMAGE_PROMPT_GENERATION handler removed.
import { runVideoGenerationJob } from "../lib/videoGenerationService.ts";
import { collectProductIntelWithWebFetch } from "../lib/productDataCollectionService.ts";
import { analyzeProductData } from "../lib/productAnalysisService.ts";
import prisma from "../lib/prisma.ts";
import { rollbackQuota } from "../lib/billing/usage.ts";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { generateRandomCharacterName } from "../lib/characterNameService.ts";
import { uploadAvatarCharacterObject } from "@/lib/s3Service";

console.log("=== WORKER ENVIRONMENT CHECK ===");
console.log("ANTHROPIC_API_KEY present:", !!cfg.raw("ANTHROPIC_API_KEY"));
console.log("ANTHROPIC_API_KEY length:", cfg.raw("ANTHROPIC_API_KEY")?.length || 0);
console.log("NODE_ENV:", cfg.raw("NODE_ENV"));
console.log("================================");

function writeLog(line: string) {
  process.stdout.write(`${line}\n`);
}

type PipelineContext = {
  mode: "alpha" | "beta";
};

const pipelineContext: PipelineContext = {
  mode: assertRuntimeMode(),
};

// Inline getRuntimeMode logic (must be JS, not TS)
function getRuntimeMode() {
  const nodeEnv = cfg.raw("NODE_ENV");
  const explicitMode = cfg.raw("MODE");
  if (nodeEnv === "production") {
    if (explicitMode === "prod" || explicitMode === "beta") {
      return explicitMode;
    }
    return "beta";
  }
  return explicitMode === "prod" || explicitMode === "beta"
    ? explicitMode
    : "dev";
}
const runtimeMode = getRuntimeMode();
writeLog(`[BOOT] Runtime mode: ${runtimeMode}`);
if (pipelineContext.mode === "alpha") {
  writeLog("[PIPELINE] Running in ALPHA mode");
}
if (pipelineContext.mode === "alpha" && cfg.raw("NODE_ENV") === "production") {
  throw new Error("INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production");
}

const POLL_MS = 2000;
const ARCHIVED_JOB_TYPES: JobType[] = [
  JobType.IMAGE_PROMPT_GENERATION,
];
const RUN_ONCE = cfg.raw("RUN_ONCE") === "1";
const WORKER_JOB_MAX_RUNTIME_MS = Number(cfg.raw("WORKER_JOB_MAX_RUNTIME_MS") ?? 20 * 60_000);
const SCRIPT_JOB_MAX_RUNTIME_MS = Number(
  cfg.raw("SCRIPT_JOB_MAX_RUNTIME_MS") ?? 45 * 60_000,
);
const JOB_TIMEOUT_RECOVERY_INTERVAL_MS = Number(
  cfg.raw("JOB_TIMEOUT_RECOVERY_INTERVAL_MS") ?? 5 * 60_000,
);
const JOB_RUNNING_STALE_MS = Number(cfg.raw("JOB_RUNNING_STALE_MS") ?? 10 * 60_000);
const SCRIPT_JOB_RUNNING_STALE_MS = Number(
  cfg.raw("SCRIPT_JOB_RUNNING_STALE_MS") ??
    Math.max(60 * 60_000, SCRIPT_JOB_MAX_RUNTIME_MS + 15 * 60_000),
);
const AD_QUALITY_GATE_JOB_TYPE = "AD_QUALITY_GATE" as JobType;
const CREATOR_AVATAR_JOB_TYPE = "CREATOR_AVATAR_GENERATION" as JobType;
const CHARACTER_SEED_VIDEO_JOB_TYPE = "CHARACTER_SEED_VIDEO" as JobType;
const CHARACTER_REFERENCE_VIDEO_JOB_TYPE = "CHARACTER_REFERENCE_VIDEO" as JobType;

type JsonObject = Record<string, any>;
type ClaimExclusions = {
  excludedJobTypes?: JobType[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

function inferImageExtension(args: { contentType: string | null; url: string }): string {
  const contentType = String(args.contentType ?? "").toLowerCase();
  if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return "jpg";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/avif")) return "avif";
  if (contentType.includes("image/gif")) return "gif";
  if (contentType.includes("image/png")) return "png";
  const cleanUrl = String(args.url ?? "").split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
  if (cleanUrl.endsWith(".webp")) return "webp";
  if (cleanUrl.endsWith(".avif")) return "avif";
  if (cleanUrl.endsWith(".gif")) return "gif";
  return "png";
}

async function persistCharacterAvatarToS3(args: {
  projectId: string;
  productId: string;
  taskId: string;
  sourceUrl: string;
}): Promise<string> {
  const sourceUrl = String(args.sourceUrl ?? "").trim();
  if (!sourceUrl) {
    throw new Error("Character avatar image URL is empty");
  }
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to download character avatar image (status=${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const body = new Uint8Array(arrayBuffer);
  const contentTypeHeader = res.headers.get("content-type");
  const ext = inferImageExtension({ contentType: contentTypeHeader, url: sourceUrl });
  const contentType =
    contentTypeHeader && contentTypeHeader.toLowerCase().startsWith("image/")
      ? contentTypeHeader
      : ext === "jpg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "avif"
            ? "image/avif"
            : ext === "gif"
              ? "image/gif"
              : "image/png";
  const key = [
    "projects",
    args.projectId,
    "products",
    args.productId,
    "character-avatars",
    `${Date.now()}-${args.taskId}.${ext}`,
  ].join("/");
  const uploadedUrl = await uploadAvatarCharacterObject({
    key,
    body,
    contentType,
    cacheControl: "public,max-age=31536000,immutable",
  });
  if (!uploadedUrl) {
    throw new Error("Avatar character generation S3 upload returned null; check avatar bucket configuration");
  }
  return uploadedUrl;
}

async function runWithJobTypeMaxRuntime<T>(
  jobType: JobType,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const timeoutMs =
    jobType === JobType.SCRIPT_GENERATION
      ? Math.max(5 * 60_000, SCRIPT_JOB_MAX_RUNTIME_MS)
      : Math.max(60_000, WORKER_JOB_MAX_RUNTIME_MS);
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

async function rollbackJobQuotaIfNeeded({
  jobId,
  projectId,
  payload,
}: {
  jobId: string;
  projectId: string;
  payload: JsonObject;
}) {
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

async function markCompleted({
  jobId,
  result,
  summary,
}: {
  jobId: string;
  result: any;
  summary?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { payload: true, resultSummary: true, status: true, runId: true, projectId: true },
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
  await updateRunStatus(existing.runId, existing.projectId);
}

async function markFailed({ jobId, error }: { jobId: string; error: unknown }) {
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { payload: true, resultSummary: true, status: true, runId: true, projectId: true },
  });
  if (!existing) return;

  const payload = asObject(existing.payload);
  let errMsg = String((error as any)?.message ?? error);
  let transient = false;
  let provider: string | null = null;
  let rawSnippet: string | null = null;

  const asAny: any = error as any;
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
  await updateRunStatus(existing.runId, existing.projectId);
}

async function updateRunStatus(runId: string | null | undefined, projectId: string) {
  if (!runId) return;

  const jobs = await prisma.job.findMany({
    where: { runId, projectId },
    select: { status: true },
  });
  if (jobs.length === 0) return;

  const hasFailedJobs = jobs.some((j) => j.status === JobStatus.FAILED);
  const hasOpenJobs = jobs.some(
    (j) => j.status === JobStatus.PENDING || j.status === JobStatus.RUNNING
  );
  const allCompleted = jobs.every((j) => j.status === JobStatus.COMPLETED);

  const status: RunStatus =
    hasFailedJobs
      ? RunStatus.FAILED
      : allCompleted
        ? RunStatus.COMPLETED
        : hasOpenJobs
          ? RunStatus.IN_PROGRESS
          : RunStatus.IN_PROGRESS;

  try {
    await prisma.researchRun.update({
      where: { id: runId },
      data: { status },
    });
  } catch (error) {
    console.warn("[Worker] Failed to update run status", { runId, projectId, error });
  }
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
    await markCompleted({ jobId, result: { ok: true, skipped: true, reason }, summary: `Skipped: ${reason}` });
    return { ok: false as const, skipped: true as const };
  }

  await markFailed({ jobId, error: reason });
  return { ok: false as const, skipped: false as const };
}

async function claimNextJob(exclusions?: ClaimExclusions) {
  const dueBefore = nowMs();
  const dueBeforeDate = new Date(dueBefore);
  const excludedTypes = [
    ...(exclusions?.excludedJobTypes || []),
    ...ARCHIVED_JOB_TYPES,
  ];
  const excludedTypePayloadCombinations: Array<{
    type: JobType;
    payloadFields: string[];
    excludedValues: string[];
  }> = [];
  console.log('[Worker] claimNextJob called');
  console.log('[Worker] dueBefore:', dueBeforeDate.toISOString());
  console.log('[Worker] claim exclusions:', {
    excludedJobTypes: excludedTypes,
    excludedTypePayloadCombinations,
  });
  console.log(
    '[Worker] Looking for jobs with status=PENDING and payload.nextRunAt <=',
    dueBeforeDate.toISOString(),
  );
  const claimed = await prisma.$queryRaw<any[]>`
    UPDATE job
    SET "status" = CAST('RUNNING' AS "JobStatus"),
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id"
      FROM job
      WHERE "status" = CAST('PENDING' AS "JobStatus")
        AND (
          ${excludedTypes.length} = 0
          OR "type" NOT IN (${Prisma.join(
            excludedTypes.map((jobType) => Prisma.sql`CAST(${jobType} AS "JobType")`),
          )})
        )
        AND (
          ("payload"->>'nextRunAt') IS NULL
          OR (("payload"->>'nextRunAt')::bigint) <= ${dueBefore}
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "projectId", "userId", "runId", "payload", "idempotencyKey", "status";
  `;

  console.log('[Worker] Raw query result:', claimed);
  console.log('[Worker] Jobs claimed:', claimed?.length || 0);

  const row = claimed[0];
  if (!row?.id) return null;
  return row as {
    id: string;
    type: JobType;
    projectId: string;
    userId: string;
    runId: string | null;
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
    runId: string | null;
    payload: unknown;
    idempotencyKey: string | null;
    status: JobStatus;
  },
  context: PipelineContext,
) {
  const jobId = job.id;
  const payload = asObject(job.payload);
  console.log('[Worker] ===== PROCESSING JOB =====');
  console.log('[Worker] Job ID:', job.id);
  console.log('[Worker] Job Type:', job.type);
  console.log('[Worker] Job Status:', job.status);
  console.log('[Worker] RunId:', (job as any).runId);
  console.log('[Worker] ===========================');

  if (job.status !== JobStatus.RUNNING) {
    throw new Error(`Invalid job state: ${job.status}`);
  }

  if (context.mode === "alpha" && cfg.raw("NODE_ENV") === "production") {
    throw new Error("INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production");
  }

  console.log("[BEFORE SWITCH] About to enter switch statement");
  console.log("[BEFORE SWITCH] job.type:", job.type);
  console.log("[BEFORE SWITCH] JobType enum:", JobType);

  try {
    switch (job.type) {
      case JobType.CUSTOMER_RESEARCH: {
        writeLog("=== CUSTOMER_RESEARCH JOB ===");
        writeLog("Checking Apify token...");
        writeLog(
          `APIFY_API_TOKEN: ${cfg.raw("APIFY_API_TOKEN") ? "exists" : "missing"}`,
        );

        const apifyToken = cfg.raw("APIFY_API_TOKEN");
        writeLog(`cfg.raw result: ${apifyToken ? "found token" : "NO TOKEN"}`);
        writeLog(`hasApifyToken: ${!!apifyToken}`);

        if (!apifyToken) {
          writeLog("SKIPPING: Apify not configured");
          await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
          await markCompleted({
            jobId,
            result: { ok: true, skipped: true, reason: "Apify not configured" },
          });
          return;
        }

        writeLog("Proceeding with research...");

        const {
          productProblemSolved,
          mainProductAsin,
          competitor1Asin,
          competitor2Asin,
          competitor3Asin,
          productAmazonAsin,
          competitor1AmazonAsin,
          competitor2AmazonAsin,
          redditKeywords,
          searchIntent,
          solutionKeywords,
          redditSubreddits,
          maxPosts,
          maxCommentsPerPost,
          timeRange,
          scrapeComments,
          additionalProblems,
        } = payload;

        const resolvedMainProductAsin = String(mainProductAsin ?? productAmazonAsin ?? "").trim();
        const resolvedCompetitor1Asin = String(
          competitor1Asin ?? competitor1AmazonAsin ?? ""
        ).trim();
        const resolvedCompetitor2Asin = String(
          competitor2Asin ?? competitor2AmazonAsin ?? ""
        ).trim();
        const resolvedCompetitor3Asin = String(competitor3Asin ?? "").trim();
        const hasAmazonAsin = Boolean(
          resolvedMainProductAsin ||
            resolvedCompetitor1Asin ||
            resolvedCompetitor2Asin ||
            resolvedCompetitor3Asin
        );
        const hasRedditKeywords =
          Array.isArray(redditKeywords) && redditKeywords.some((k: any) => String(k).trim().length > 0);
        const hasSearchIntent =
          Array.isArray(searchIntent) && searchIntent.some((k: any) => String(k).trim().length > 0);
        const hasSolutionKeywords =
          Array.isArray(solutionKeywords) && solutionKeywords.some((k: any) => String(k).trim().length > 0);
        const hasAdditionalProblems =
          Array.isArray(additionalProblems) &&
          additionalProblems.some((k: any) => String(k).trim().length > 0);
        const hasProblem = Boolean(productProblemSolved && String(productProblemSolved).trim());

        if (!hasAmazonAsin && !hasRedditKeywords && !hasSearchIntent && !hasSolutionKeywords && !hasAdditionalProblems && !hasProblem) {
          await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
          await markFailed({
            jobId,
            error:
              "Invalid payload: provide mainProductAsin/competitorAsin or Reddit problem/search inputs (productProblemSolved, searchIntent, solutionKeywords, additionalProblems, redditKeywords)",
          });
          return;
        }

        const result = await runCustomerResearch({
          projectId: job.projectId,
          jobId,
          productProblemSolved,
          mainProductAsin: resolvedMainProductAsin || undefined,
          competitor1Asin: resolvedCompetitor1Asin || undefined,
          competitor2Asin: resolvedCompetitor2Asin || undefined,
          competitor3Asin: resolvedCompetitor3Asin || undefined,
          redditKeywords,
          searchIntent,
          solutionKeywords,
          redditSubreddits,
          maxPosts,
          maxCommentsPerPost,
          timeRange,
          scrapeComments,
          additionalProblems,
        });

        await markCompleted({
          jobId,
          result: { ok: true, rows: Array.isArray(result) ? result.length : null },
        });
        return;
      }
      case JobType.CUSTOMER_ANALYSIS: {
        console.log("=== CUSTOMER_ANALYSIS JOB START ===");
        console.log("Job ID:", jobId);
        console.log("Payload:", JSON.stringify(payload, null, 2));

        try {
          console.log("Calling runCustomerAnalysis...");
          const analysisResult = await runCustomerAnalysis({
            projectId: job.projectId,
            ...(payload as any),
          });
          console.log("Analysis result:", JSON.stringify(analysisResult, null, 2));
          await markCompleted({
            jobId,
            result: analysisResult,
            summary: {
              avatarId: analysisResult?.avatarId ?? null,
              summary: analysisResult?.summary ?? null,
            },
          });
        } catch (error) {
          console.error("=== CUSTOMER_ANALYSIS ERROR ===");
          console.error("Error:", error);
          console.error("Stack:", (error as Error).stack);
          await markFailed({ jobId, error });
        }
        return;
      }

      case JobType.AD_PERFORMANCE: {
        const adSubtype = String(payload?.jobType ?? payload?.kind ?? "ad_raw_collection");

        if (adSubtype === "ad_transcripts" || adSubtype === "ad_transcript_collection") {
          const cfgAssembly = await handleProviderConfig(jobId, "AssemblyAI", ["ASSEMBLYAI_API_KEY"]);
          if (!cfgAssembly.ok) return;

          const runId = String(payload?.runId ?? (job as any)?.runId ?? "").trim();
          const forceReprocess = payload?.forceReprocess === true;
          if (!runId) {
            await markFailed({ jobId, error: "Invalid payload: missing runId" });
            return;
          }

          const result = await runAdTranscriptCollection({
            projectId: job.projectId,
            jobId,
            runId,
            forceReprocess,
          });

          await markCompleted({
            jobId,
            result: { ok: true, ...result },
            summary: `Transcripts: ${result.processed}/${result.totalAssets}`,
          });
          return;
        }

        if (adSubtype === "ad_ocr_collection") {
          const cfgVision = await handleProviderConfig(jobId, "Google Vision", [
            "GOOGLE_CLOUD_VISION_API_KEY",
          ]);
          if (!cfgVision.ok) return;

          const runId = String(payload?.runId ?? (job as any)?.runId ?? "").trim();
          const forceReprocess = payload?.forceReprocess === true;

          const result = await runAdOcrCollection({
            projectId: job.projectId,
            jobId,
            runId,
            forceReprocess,
          });

          await markCompleted({
            jobId,
            result: { ok: true, ...result },
            summary: `OCR: ${result.processed}/${result.totalAssets}`,
          });
          return;
        }

        const hasApifyToken = Boolean(
          String(cfg.raw("APIFY_API_TOKEN") ?? "").trim() ||
            String(cfg.raw("APIFY_TOKEN") ?? "").trim()
        );
        if (!hasApifyToken) {
          await markFailed({ jobId, error: "Apify not configured" });
          return;
        }
        const datasetId = (cfg.raw("APIFY_DATASET_ID") ?? "").trim();
        if (!datasetId) {
          const cfgActor = await handleProviderConfig(jobId, "Apify TikTok", ["APIFY_TIKTOK_ACTOR_ID"]);
          if (!cfgActor.ok) return;
        }

        const { industryCode } = payload;
        if (!industryCode) {
          await markFailed({ jobId, error: "Invalid payload: missing industryCode" });
          return;
        }

        const runId = String(payload?.runId ?? (job as any)?.runId ?? "").trim();
        const configured =
          payload?.adCollectionConfig && typeof payload.adCollectionConfig === "object"
            ? (payload.adCollectionConfig as AdCollectionConfig)
            : null;
        const adCollectionConfig = configured ?? buildAdCollectionConfig(String(industryCode));

        const result = await collectAds(
          job.projectId,
          runId,
          jobId,
          adCollectionConfig,
        );

        await markCompleted({
          jobId,
          result: { ok: true, apify: result.apify, ads: result.ads },
          summary: `Ads: ${result.apify.itemCount}`,
        });
        return;
      }

      case AD_QUALITY_GATE_JOB_TYPE: {
        const cfgAnthropic = await handleProviderConfig(jobId, "Anthropic", ["ANTHROPIC_API_KEY"]);
        if (!cfgAnthropic.ok) return;

        const runId = String(payload?.runId ?? (job as any)?.runId ?? "").trim();
        if (!runId) {
          await markFailed({ jobId, error: "Invalid payload: missing runId" });
          return;
        }

        const forceReprocess = payload?.forceReprocess === true;
        const result = await runAdQualityGate({
          projectId: job.projectId,
          jobId,
          runId,
          forceReprocess,
        });

        await markCompleted({
          jobId,
          result: { ok: true, ...result },
          summary: result.summary,
        });
        return;
      }

      case JobType.PATTERN_ANALYSIS: {
        const runIdFromPayload = String(payload?.runId ?? "").trim() || null;
        const runIdFromJob = String((job as any)?.runId ?? "").trim() || null;
        const effectiveRunId = runIdFromPayload ?? runIdFromJob;

        // The claim query already transitions PENDING -> RUNNING.
        // Avoid a duplicate RUNNING -> RUNNING transition here.

        const result = await runPatternAnalysis({
          projectId: job.projectId,
          runId: effectiveRunId,
          jobId,
        });

        await markCompleted({
          jobId,
          result,
          summary: `Patterns: ${result.patterns.hookPatterns.length} hooks`,
        });
        return;
      }

      case JobType.SCRIPT_GENERATION: {
        const cfg = await handleProviderConfig(jobId, "Anthropic", ["ANTHROPIC_API_KEY"]);
        if (!cfg.ok) return;

        const fresh = await prisma.job.findUnique({ where: { id: jobId } });
        if (!fresh) {
          await markFailed({ jobId, error: "Job not found after claim" });
          return;
        }

        const result = await startScriptGenerationJob(job.projectId, fresh);
        await markCompleted({ jobId, result: { ok: true, ...result } });
        return;
      }

      case JobType.STORYBOARD_GENERATION: {
        const scriptId = String(payload?.scriptId ?? "").trim();
        const productId = String(payload?.productId ?? "").trim() || null;
        const characterName = String(payload?.characterName ?? "").trim() || null;
        const characterDescription = String(payload?.characterDescription ?? "").trim() || null;
        const storyboardMode = String(payload?.storyboardMode ?? "").trim() === "manual" ? "manual" : "ai";
        const manualPanels = Array.isArray(payload?.manualPanels) ? payload.manualPanels : undefined;
        if (!scriptId) {
          await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
          await markFailed({ jobId, error: "Invalid payload: missing scriptId" });
          return;
        }

        try {
          const result = await generateStoryboard(scriptId, {
            productId,
            characterName,
            characterDescription,
            storyboardMode,
            manualPanels,
          });
          const validationReport = (result as any)?.validationReport;
          const warningCount = Array.isArray(validationReport?.warnings)
            ? validationReport.warnings.length
            : 0;

          await markCompleted({
            jobId,
            result: {
              ok: true,
              storyboardId: result.storyboardId,
              scriptId,
              panelCount: result.panelCount,
              targetDuration: result.targetDuration,
              ...(validationReport && { validationReport }),
            },
            summary: {
              summary: `Generated ${result.panelCount} panels for ${result.targetDuration}s video.${warningCount > 0 ? ` ${warningCount} quality warning${warningCount === 1 ? "" : "s"}.` : ""}`,
              storyboardId: result.storyboardId,
              scriptId,
              panelCount: result.panelCount,
              targetDuration: result.targetDuration,
              ...(validationReport && { validationReport }),
            },
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
          await markFailed({ jobId, error: e });
          await appendResultSummary(jobId, `Storyboard generation failed: ${msg}`);
        }
        return;
      }

      case JobType.VIDEO_PROMPT_GENERATION: {
        console.log("[Worker][VIDEO_PROMPT_GENERATION] Entry", {
          jobId,
          payload,
        });
        const storyboardId = String(payload?.storyboardId ?? "").trim();
        const productId = String(payload?.productId ?? "").trim() || null;
        const characterName = String(payload?.characterName ?? "").trim() || null;
        const characterDescription = String(payload?.characterDescription ?? "").trim() || null;
        if (!storyboardId) {
          await markFailed({ jobId, error: "Invalid payload: missing storyboardId" });
          return;
        }

        const storyboard = await prisma.storyboard.findUnique({
          where: { id: storyboardId },
          select: { id: true, scriptId: true },
        });
        if (!storyboard?.id) {
          await markFailed({ jobId, error: `Storyboard not found for id=${storyboardId}` });
          return;
        }

        console.log("[Worker][VIDEO_PROMPT_GENERATION] About to execute video prompt generation", {
          jobId,
          storyboardId,
        });

        let result: Awaited<ReturnType<typeof startVideoPromptGenerationJob>>;
        try {
          result = await startVideoPromptGenerationJob({
            storyboardId,
            jobId,
            productId,
            characterName,
            characterDescription,
          });
          console.log("[Worker][VIDEO_PROMPT_GENERATION] Video prompt generation completed", {
            jobId,
            storyboardId,
            success: true,
            error: null,
          });
        } catch (error: any) {
          console.log("[Worker][VIDEO_PROMPT_GENERATION] Video prompt generation completed", {
            jobId,
            storyboardId,
            success: false,
            error: String(error?.message ?? error),
          });
          throw error;
        }
        await markCompleted({
          jobId,
          result,
          summary: `Video prompts generated: ${result.processed}/${result.sceneCount} scenes`,
        });

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

      // ARCHIVED: Use VIDEO_PROMPT_GENERATION with Sora 2 instead.
      // case "IMAGE_PROMPT_GENERATION" as JobType: {
      //   return;
      // }

      case JobType.VIDEO_IMAGE_GENERATION: {
        const providerCfg = await handleProviderConfig(jobId, "KIE", ["KIE_API_KEY"]);
        if (!providerCfg.ok) return;
        try {
          await runVideoImageGenerationJob({ jobId });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await markFailed({ jobId, error: e });
          await appendResultSummary(jobId, `Video image generation failed: ${msg}`);
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
          await markFailed({ jobId, error: msg });
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
          await markCompleted({ jobId, result, summary });
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Unknown error");
          await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
          await markFailed({ jobId, error: e });
          await appendResultSummary(jobId, `Video generation failed: ${msg}`);
        }
        return;
      }

      case 'PRODUCT_DATA_COLLECTION' as any: {
        const { projectId, productUrl, returnsUrl, shippingUrl, aboutUrl } = payload as {
          projectId?: string;
          productUrl?: string;
          returnsUrl?: string | null;
          shippingUrl?: string | null;
          aboutUrl?: string | null;
        };
        console.log("[Product Collection Worker] Starting job:", {
          jobId,
          projectId: projectId || job.projectId,
          productUrl,
          returnsUrl: returnsUrl || null,
          shippingUrl: shippingUrl || null,
          aboutUrl: aboutUrl || null,
        });
        if (!productUrl) {
          await markFailed({ jobId, error: "Invalid payload: missing productUrl" });
          return;
        }

        try {
          const intel = await collectProductIntelWithWebFetch(
            String(productUrl),
            String(projectId || job.projectId),
            jobId,
            typeof returnsUrl === "string" ? returnsUrl : null,
            typeof shippingUrl === "string" ? shippingUrl : null,
            typeof aboutUrl === "string" ? aboutUrl : null
          );
          console.log("[Product Collection Worker] Extraction complete:", {
            jobId,
            benefit: (intel as any)?.main_benefit ?? null,
          });

          const intelPrice =
            typeof (intel as any)?.price === "string"
              ? (intel as any).price
              : (intel as any)?.price?.current ?? null;
          const intelLabel =
            (intel as any)?.name ??
            (intel as any)?.main_benefit ??
            (intel as any)?.benefit ??
            (intel as any)?.title ??
            null;

          await markCompleted({
            jobId,
            result: { success: true, intel },
            summary: {
              success: true,
              productName: intelLabel,
              price: intelPrice,
            },
          });
          return;
        } catch (error: any) {
          const msg = String(error?.message ?? error ?? "");
          console.error("[Product Collection Worker] Job failed:", {
            jobId,
            error: msg,
          });
          if (msg.includes("url_not_accessible")) {
            await markCompleted({
              jobId,
              result: { success: false, error: "Product page not accessible" },
              summary: { success: false, error: "Product page not accessible" },
            });
            return;
          }
          if (msg.includes("max_uses_exceeded")) {
            await markCompleted({
              jobId,
              result: { success: false, error: "Too many fetch attempts" },
              summary: { success: false, error: "Too many fetch attempts" },
            });
            return;
          }
          throw error;
        }
      }

      case 'PRODUCT_ANALYSIS' as any: {
        const { runId } = payload;

        const result = await analyzeProductData({
          projectId: job.projectId,
          jobId,
          runId,
        });

        await markCompleted({ jobId, result, summary: "Product analysis completed" });
        return;
      }

      case CREATOR_AVATAR_JOB_TYPE: {
        const productId = String(payload?.productId ?? "").trim();
        if (!productId) {
          await markFailed({ jobId, error: "Invalid payload: missing productId" });
          return;
        }

        const productState = await getProductCharacterState(productId, job.projectId);
        if (!productState) {
          await markFailed({ jobId, error: `Product not found: ${productId}` });
          return;
        }

        const manualDescription =
          typeof payload?.manualDescription === "string" ? payload.manualDescription : null;

        const avatarResult = await generateCreatorAvatar({
          projectId: job.projectId,
          productId,
          manualDescription,
          characterName: String(payload?.characterName ?? "").trim() || null,
        });
        await saveCreatorVisualPrompt(productId, avatarResult.creatorVisualPrompt);

        const nextIdempotencyKey = JSON.stringify([
          job.projectId,
          CHARACTER_SEED_VIDEO_JOB_TYPE,
          productId,
          "from",
          jobId,
        ]);

        try {
          await prisma.job.create({
            data: {
              projectId: job.projectId,
              userId: job.userId,
              runId: job.runId ?? null,
              type: CHARACTER_SEED_VIDEO_JOB_TYPE,
              status: JobStatus.PENDING,
              idempotencyKey: nextIdempotencyKey,
              payload: {
                projectId: job.projectId,
                productId,
                runId: job.runId ?? null,
                creatorVisualPrompt: avatarResult.creatorVisualPrompt,
                avatarImagePrompt: avatarResult.imagePrompt,
                characterName: String(payload?.characterName ?? "").trim() || null,
                upstreamJobId: jobId,
              },
            },
          });
        } catch (e: any) {
          const code = String(e?.code ?? "");
          const msg = String(e?.message ?? "");
          const isUnique = code === "P2002" || msg.toLowerCase().includes("unique constraint");
          if (!isUnique) {
            throw e;
          }
        }

        await markCompleted({
          jobId,
          result: {
            ok: true,
            productId,
            source: avatarResult.source,
            creatorVisualPrompt: avatarResult.creatorVisualPrompt,
          },
          summary: `Creator avatar prompt generated (${avatarResult.source})`,
        });
        return;
      }

      case CHARACTER_SEED_VIDEO_JOB_TYPE: {
        const providerCfg = await handleProviderConfig(jobId, "KIE", ["KIE_API_KEY"]);
        if (!providerCfg.ok) {
          return;
        }

        const productId = String(payload?.productId ?? "").trim();
        if (!productId) {
          await markFailed({ jobId, error: "Invalid payload: missing productId" });
          return;
        }

        const MAX_WALL_MS = 10 * 60 * 1000;
        const POLL_INTERVAL_MS = 10_000;
        const seedStartedAt = Number(payload?.seedStartedAt ?? Date.now());
        const elapsed = Date.now() - seedStartedAt;

        if (elapsed > MAX_WALL_MS) {
          await markFailed({ jobId, error: "Character avatar image timed out after 10 minutes" });
          return;
        }

        if (payload?.seedTaskId) {
          const seedTaskId = String(payload.seedTaskId).trim();
          const raw = await getTask(seedTaskId);
          const normalized =
            typeof raw === "string" ? "RUNNING" : normalizeKieState(raw as Record<string, unknown>);

          if (normalized === "SUCCEEDED") {
            const rawImageUrl =
              typeof raw === "string" ? null : extractImageUrl(raw as Record<string, unknown>);
            if (!rawImageUrl) {
              await markFailed({ jobId, error: "KIE character avatar image task succeeded but image URL is missing" });
              return;
            }
            const imageUrl = await persistCharacterAvatarToS3({
              projectId: String(job.projectId),
              productId,
              taskId: seedTaskId,
              sourceUrl: rawImageUrl,
            });
            const requestedCharacterName = String(payload?.characterName ?? "").trim();
            await saveCharacterAvatarImage(productId, { taskId: seedTaskId, imageUrl });
            await saveCharacterToTable({
              productId,
              runId: job.runId ?? null,
              name: requestedCharacterName || generateRandomCharacterName(),
              seedVideoUrl: imageUrl ?? undefined,
              seedVideoTaskId: seedTaskId,
              soraCharacterId: seedTaskId,
              characterUserName: `avatar_${seedTaskId.slice(0, 8)}`,
              creatorVisualPrompt: String(payload?.creatorVisualPrompt ?? ""),
            });
            await markCompleted({
              jobId,
              result: { ok: true, productId, taskId: seedTaskId, characterAvatarImageUrl: imageUrl },
              summary: "Character avatar image generated",
            });
            return;
          }

          if (normalized === "FAILED") {
            await markFailed({ jobId, error: "KIE character avatar image task failed" });
            return;
          }

          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: JobStatus.PENDING,
              payload: {
                ...payload,
                seedTaskId,
                seedStartedAt,
                nextRunAt: Date.now() + POLL_INTERVAL_MS,
              },
            },
          });
          return;
        }

        const productState = await getProductCharacterState(productId, job.projectId);
        if (!productState) {
          await markFailed({ jobId, error: `Product not found: ${productId}` });
          return;
        }

        const avatarImagePrompt = String(
          payload?.avatarImagePrompt ?? payload?.creatorVisualPrompt ?? productState.creatorVisualPrompt ?? "",
        ).trim();
        if (!avatarImagePrompt) {
          await markFailed({ jobId, error: "Missing avatar image prompt" });
          return;
        }

        const seedCreate = await createCharacterAvatarImage({ prompt: avatarImagePrompt });

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.PENDING,
            payload: {
              ...payload,
              seedTaskId: seedCreate.taskId,
              seedStartedAt: Date.now(),
              nextRunAt: Date.now() + POLL_INTERVAL_MS,
            },
          },
        });
        return;
      }

      case CHARACTER_REFERENCE_VIDEO_JOB_TYPE: {
        await markCompleted({
          jobId,
          result: { ok: true, skipped: true, reason: "Legacy CHARACTER_REFERENCE_VIDEO stage retired" },
          summary: "Skipped retired character reference stage",
        });
        return;
      }

      default: {
        await markFailed({ jobId, error: "Not implemented" });
        return;
      }
    }
  } catch (e: any) {
    try {
      await rollbackJobQuotaIfNeeded({ jobId, projectId: job.projectId, payload });
      await markFailed({ jobId, error: e });
    } catch (updateErr) {
      console.error("[jobRunner] failed to persist job failure", { jobId, updateErr });
    }
  }
}

async function recoverTimedOutRunningJobs(trigger: "startup" | "interval") {
  const now = Date.now();
  const staleBeforeIso = new Date(now - JOB_RUNNING_STALE_MS).toISOString();
  const scriptStaleBeforeIso = new Date(now - SCRIPT_JOB_RUNNING_STALE_MS).toISOString();
  const recoveredCount = await prisma.$executeRaw`
    UPDATE job
    SET "status" = CAST('FAILED' AS "JobStatus"),
        "error" = to_jsonb('Job timeout - exceeded maximum runtime'::text),
        "updatedAt" = NOW()
    WHERE "status" = CAST('RUNNING' AS "JobStatus")
      AND (
        (
          "type" = CAST('SCRIPT_GENERATION' AS "JobType")
          AND "updatedAt" < ${scriptStaleBeforeIso}::timestamptz
        )
        OR (
          "type" <> CAST('SCRIPT_GENERATION' AS "JobType")
          AND "updatedAt" < ${staleBeforeIso}::timestamptz
        )
      )
  `;

  if (recoveredCount > 0) {
    writeLog(
      `[jobRunner] timeout recovery (${trigger}): marked ${recoveredCount} RUNNING job(s) as FAILED`,
    );
  }
}

async function loop() {
  writeLog(`[jobRunner] start poll=${POLL_MS}ms runOnce=${RUN_ONCE} mode=${pipelineContext.mode}`);
  let nextTimeoutRecoveryAt = nowMs() + JOB_TIMEOUT_RECOVERY_INTERVAL_MS;

  while (true) {
    if (nowMs() >= nextTimeoutRecoveryAt) {
      try {
        await recoverTimedOutRunningJobs("interval");
      } catch (e) {
        console.error("[jobRunner] timeout recovery (interval) error", e);
      } finally {
        nextTimeoutRecoveryAt = nowMs() + JOB_TIMEOUT_RECOVERY_INTERVAL_MS;
      }
    }

    writeLog("[WORKER] Polling for jobs...");
    let job: Awaited<ReturnType<typeof claimNextJob>> | null = null;
    try {
      job = await claimNextJob();
      if (!job) {
        writeLog("[WORKER] No jobs to claim");
        const allPending = await prisma.job.findMany({
          where: { status: "PENDING" },
          take: 5,
          select: {
            id: true,
            type: true,
            status: true,
            payload: true,
            createdAt: true,
          },
        });
        console.log('[Worker] Found jobs:', allPending.length);
        console.log('[Worker] Job types:', allPending.map(j => j.type));
        const pendingSeeds = await prisma.$queryRaw<
          Array<{ id: string; next_run_at: string | null; updatedAt: Date }>
        >`
          SELECT id, payload->>'nextRunAt' as next_run_at, "updatedAt"
          FROM job
          WHERE type = CAST('CHARACTER_SEED_VIDEO' AS "JobType")
            AND status = CAST('PENDING' AS "JobStatus")
        `;
        console.log('[Worker] Pending seed jobs:', pendingSeeds);
        writeLog(
          `[WORKER] PENDING jobs in database: ${JSON.stringify(allPending, null, 2)}`,
        );
        if (RUN_ONCE) return;
        await sleep(POLL_MS);
        continue;
      }

      writeLog(`[WORKER] Claimed job: ${job.id} Type: ${job.type}`);
      try {
        await runWithJobTypeMaxRuntime(job.type, `job ${job.id}`, () =>
          runJob(job!, pipelineContext),
        );
      } catch (e) {
        try {
          await markFailed({ jobId: job.id, error: e });
        } catch (updateErr) {
          console.error("[jobRunner] failed to mark timed-out job as FAILED", {
            jobId: job.id,
            updateErr,
          });
        }
        throw e;
      }
      writeLog(`[WORKER] Finished job: ${job.id}`);
      if (!RUN_ONCE) {
        await sleep(POLL_MS);
      }
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

const STARTUP_DELAY_MS = 10_000;
const STARTUP_POST_ENV_DELAY_MS = 5_000;

async function startWorker() {
  writeLog("=== WORKER STARTING ===");
  writeLog("Waiting 10 seconds before checking environment...");
  await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));

  writeLog("=== WORKER ENV CHECK ===");
  writeLog(
    `APIFY_API_TOKEN: ${cfg.raw("APIFY_API_TOKEN") ? "✓ Present" : "✗ Missing"}`,
  );
  writeLog(
    `ANTHROPIC_API_KEY: ${cfg.raw("ANTHROPIC_API_KEY") ? "✓ Present" : "✗ Missing"}`,
  );
  writeLog(`NODE_ENV: ${cfg.raw("NODE_ENV")}`);
  writeLog("========================");
  writeLog("Starting job polling in 5 seconds...");
  await new Promise((resolve) => setTimeout(resolve, STARTUP_POST_ENV_DELAY_MS));

  try {
    await recoverTimedOutRunningJobs("startup");
  } catch (e) {
    console.error("[jobRunner] timeout recovery (startup) error", e);
  }

  await loop();
}

process.on("unhandledRejection", (reason) => {
  console.error("[jobRunner] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[jobRunner] uncaughtException", err);
});

startWorker()
  .catch((e) => {
    console.error("[jobRunner] fatal", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
