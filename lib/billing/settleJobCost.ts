import { JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentPeriodKey } from "@/lib/billing/usage";
import { computeAssemblyAICostCents, computeGoogleVisionCostCents } from "@/lib/billing/pricing";

export type UsageEntryInput = {
  metric: string;
  provider?: string | null;
  model?: string | null;
  units?: number | null;
  costCents?: number | null;
  metadata?: Record<string, unknown> | null;
};

type SettleJobCostArgs = {
  jobId: string;
  userId: string;
  projectId: string;
  usageEntries: UsageEntryInput[];
};

type PricingUsageEntry = {
  metric: string;
  provider: string;
  model: string | null;
  units: number;
  costCents: number;
  metadata: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toSafeInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toCostCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  // Treat integer-ish values as cents; decimal values are interpreted as dollars.
  if (Number.isInteger(n)) {
    return Math.trunc(n);
  }
  return Math.round(n * 100);
}

function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

function tokensCostCents(tokens: number, dollarsPerMillion: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return dollarsToCents((tokens / 1_000_000) * dollarsPerMillion);
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const n = Number(obj[key]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function estimateCostCents(entry: PricingUsageEntry): number {
  if (entry.costCents !== 0) return entry.costCents;

  const provider = entry.provider.toLowerCase();
  const model = String(entry.model ?? "").toLowerCase();
  const metric = entry.metric.toLowerCase();
  const units = Math.max(0, Number(entry.units) || 0);
  const metadata = asObject(entry.metadata);

  if (provider === "anthropic") {
    // Claude 4.x pricing (provided by user): Sonnet 4.x and Opus 4.6/4.5
    const isOpus = model.includes("opus");
    const inputRate = isOpus ? 5 : 3; // $ / MTok
    const outputRate = isOpus ? 25 : 15; // $ / MTok
    const cacheWrite5mRate = isOpus ? 6.25 : 3.75; // $ / MTok
    const cacheReadRate = isOpus ? 0.5 : 0.3; // $ / MTok

    const inputTokens = readNumber(metadata, "inputTokens", "input_tokens");
    const outputTokens = readNumber(metadata, "outputTokens", "output_tokens");
    const cacheWriteTokens = readNumber(
      metadata,
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
      "cacheWriteTokens",
    );
    const cacheReadTokens = readNumber(
      metadata,
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cacheReadTokens",
    );

    const fallbackInputTokens =
      inputTokens <= 0 && outputTokens <= 0 && metric === "tokens" ? units : 0;

    return (
      tokensCostCents(inputTokens > 0 ? inputTokens : fallbackInputTokens, inputRate) +
      tokensCostCents(outputTokens, outputRate) +
      tokensCostCents(cacheWriteTokens, cacheWrite5mRate) +
      tokensCostCents(cacheReadTokens, cacheReadRate)
    );
  }

  if (provider === "kie") {
    // Veo pricing from user input: fast $0.05/s, quality $0.25/s
    const isVeoFast =
      model.includes("veo3_fast") ||
      model.includes("veo3-fast") ||
      model.includes("veo 3.1 fast");
    const isVeoQuality =
      (model.includes("veo3") && !isVeoFast) ||
      model.includes("veo3-quality") ||
      model.includes("veo 3.1 quality");
    if (isVeoFast || isVeoQuality) {
      const perSecondDollars = isVeoFast ? 0.05 : 0.25;
      const durationSecFromMeta = readNumber(
        metadata,
        "durationSec",
        "seconds",
        "videoSeconds",
        "duration_seconds",
      );
      const fallbackSeconds = units > 0 ? units * 8 : 8;
      const durationSeconds = Math.max(0, durationSecFromMeta || fallbackSeconds);
      const fps = readNumber(metadata, "fps", "targetFps", "target_fps");
      const fpsMultiplier = fps >= 60 ? 2 : 1;
      return dollarsToCents(durationSeconds * perSecondDollars * fpsMultiplier);
    }

    // Nano Banana pricing from user input. Defaulting to 2K when resolution is unknown.
    const resolutionRaw = asString(metadata.resolution) || asString(metadata.imageResolution);
    const resolution = resolutionRaw.toLowerCase();
    const isPro = model.includes("nano-banana-pro");
    const isNanoBanana = model.includes("nano-banana");
    if (isNanoBanana) {
      let perImageDollars = isPro ? 0.09 : 0.06; // default 2K
      if (resolution.includes("4k")) perImageDollars = isPro ? 0.12 : 0.09;
      if (resolution.includes("1k")) perImageDollars = isPro ? 0.09 : 0.04;
      return dollarsToCents(Math.max(1, units) * perImageDollars);
    }
  }

  if (provider === "apify") {
    // TikTok Creative Center Top Ads Scraper: $0.005 per 10 ads.
    // => $0.0005 per ad
    return dollarsToCents(units * 0.0005);
  }

  if (provider === "assemblyai") {
    // Batch transcription (Universal model): $0.00025 / second
    const secondsFromMeta = readNumber(
      metadata,
      "billedAudioSeconds",
      "audioSeconds",
      "audio_seconds",
      "durationSec",
      "duration_seconds",
    );
    const seconds = secondsFromMeta > 0 ? secondsFromMeta : units;
    return dollarsToCents(seconds * 0.00025);
  }

  if (provider === "google_vision") {
    // OCR: $1.50 / 1000 requests
    const requestCount = units;
    return dollarsToCents((requestCount / 1000) * 1.5);
  }

  if (provider === "amazon" || (provider === "internal" && model === "amazon_reviews")) {
    // Amazon reviews: $0.75 / 1000 reviews
    return dollarsToCents((units / 1000) * 0.75);
  }

  if (provider === "fal") {
    if (model.includes("merge-videos")) {
      // $0.00017 per compute second
      const computeSeconds = readNumber(
        metadata,
        "computeSeconds",
        "compute_seconds",
        "seconds",
      );
      const seconds = computeSeconds > 0 ? computeSeconds : units;
      return dollarsToCents(seconds * 0.00017);
    }
    if (model.includes("video-upscaler")) {
      // $/video-second by output tier, 60fps doubles
      const videoSeconds = readNumber(
        metadata,
        "videoSeconds",
        "video_seconds",
        "seconds",
      );
      const seconds = videoSeconds > 0 ? videoSeconds : units;
      const outputHeight = readNumber(
        metadata,
        "outputHeight",
        "height",
        "resolutionHeight",
      );
      const basePerSecond =
        outputHeight > 1080 ? 0.08 : outputHeight > 720 ? 0.02 : 0.01;
      const fps = readNumber(metadata, "fps", "targetFps", "target_fps");
      const fpsMultiplier = fps >= 60 ? 2 : 1;
      return dollarsToCents(seconds * basePerSecond * fpsMultiplier);
    }
  }

  return 0;
}

function normalizeUsageEntries(
  entries: UsageEntryInput[],
): Array<
  UsageEntryInput & {
    segmentKey: string;
    units: number;
    costCents: number;
    provider: string;
    metric: string;
    metadata: Record<string, unknown>;
  }
> {
  return entries
    .map((entry, index) => {
      const provider = asString(entry.provider) || "internal";
      const model = asString(entry.model) || null;
      const metric = asString(entry.metric) || "jobs";
      const units = Math.max(0, toSafeInt(entry.units, 0));
      const metadata = asObject(entry.metadata);
      const explicitCostCents = toCostCents(entry.costCents);
      const costCents = estimateCostCents({
        metric,
        provider,
        model,
        units,
        costCents: explicitCostCents,
        metadata,
      });
      const segmentKey = [provider, model || "na", metric, String(index)].join("|");

      return {
        ...entry,
        provider,
        model,
        metric,
        units,
        costCents,
        metadata,
        segmentKey,
      };
    })
    .filter((entry) => entry.units > 0 || entry.costCents !== 0);
}

function defaultMetricForJobType(jobType: JobType): string {
  switch (jobType) {
    case JobType.VIDEO_IMAGE_GENERATION:
      return "imageJobs";
    case JobType.VIDEO_GENERATION:
    case JobType.VIDEO_PROMPT_GENERATION:
    case JobType.VIDEO_REVIEW:
    case JobType.VIDEO_UPSCALER:
      return "videoJobs";
    default:
      return "researchQueries";
  }
}

export function buildUsageEntriesForJob(args: {
  jobType: JobType;
  payload: unknown;
  result: unknown;
}): UsageEntryInput[] {
  const payload = asObject(args.payload);
  const result = asObject(args.result);

  const candidates: unknown[] = [
    (result as any).usageEntries,
    (result as any).providerUsage,
    asObject((result as any).billing).usageEntries,
  ];

  const extracted: UsageEntryInput[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const rawEntry of candidate) {
      const entry = asObject(rawEntry);
      const metric = asString(entry.metric) || asString(entry.type) || "";
      if (!metric) continue;
      extracted.push({
        metric,
        provider: asString(entry.provider) || asString(entry.vendor) || null,
        model: asString(entry.model) || null,
        units: toSafeInt(entry.units ?? entry.count ?? entry.total, 0),
        costCents: toCostCents(entry.costCents ?? entry.cost ?? 0),
        metadata: asObject(entry.metadata),
      });
    }
  }

  // Job-type specific extraction when services don't emit usageEntries directly.
  if (args.jobType === JobType.AD_PERFORMANCE) {
    const subtype = asString((payload as any).jobType).toLowerCase();
    if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
      const billedAudioSeconds = toSafeInt(
        (result as any).billedAudioSeconds ?? (result as any).audioSeconds ?? 0,
        0,
      );
      const apiCalls = toSafeInt((result as any).apiCalls ?? 0, 0);
      if (billedAudioSeconds > 0 || apiCalls > 0) {
        extracted.push({
          metric: "audioSeconds",
          provider: "assemblyai",
          model: "universal",
          units: Math.max(0, billedAudioSeconds),
          costCents: computeAssemblyAICostCents(Math.max(0, billedAudioSeconds), "universal", false),
          metadata: { billedAudioSeconds, apiCalls },
        });
      }
    }

    if (subtype === "ad_ocr_collection") {
      const apiCalls = toSafeInt((result as any).apiCalls ?? 0, 0);
      if (apiCalls > 0) {
        extracted.push({
          metric: "ocrRequests",
          provider: "google_vision",
          model: "document_text_detection",
          units: apiCalls,
          costCents: computeGoogleVisionCostCents(apiCalls),
          metadata: { apiCalls },
        });
      }
    }

    const apify = asObject((result as any).apify);
    const adCount = toSafeInt(apify.itemCount ?? (result as any).totalSaved ?? (result as any).totalValidated, 0);
    if (adCount > 0) {
      extracted.push({
        metric: "adRecords",
        provider: "apify",
        model: "tiktok-creative-center-top-ads",
        units: adCount,
        costCents: 0,
        metadata: {
          actorId: asString(apify.actorId) || null,
          datasetId: asString(apify.datasetId) || null,
          apifyRunId: asString(apify.runId) || null,
        },
      });
    }
  }

  if (args.jobType === JobType.CUSTOMER_RESEARCH) {
    const totalAmazonReviews = toSafeInt(
      (result as any).totalAmazonReviews ?? 0,
      0,
    );
    const apify = asObject((result as any).apify);
    const apifyAdCount = toSafeInt(
      apify.itemCount ??
        (result as any).totalSaved ??
        0,
      0,
    );

    if (totalAmazonReviews > 0) {
      extracted.push({
        metric: "amazonReviews",
        provider: "amazon",
        model: "amazon_reviews",
        units: totalAmazonReviews,
        costCents: 0,
        metadata: {
          mainProductReviews: toSafeInt((result as any).mainProductReviews, 0),
          competitor1Reviews: toSafeInt((result as any).competitor1Reviews, 0),
          competitor2Reviews: toSafeInt((result as any).competitor2Reviews, 0),
          competitor3Reviews: toSafeInt((result as any).competitor3Reviews, 0),
          source: "customer_research",
        },
      });
    }

    if (apifyAdCount > 0) {
      extracted.push({
        metric: "adRecords",
        provider: "apify",
        model: "tiktok-creative-center-top-ads",
        units: apifyAdCount,
        costCents: 0,
        metadata: {
          actorId: asString(apify.actorId) || null,
          datasetId: asString(apify.datasetId) || null,
          apifyRunId: asString(apify.runId) || null,
          source: "customer_research",
        },
      });
    }
  }

  const quotaReservation = asObject((payload as any).quotaReservation);
  const quotaMetric = asString(quotaReservation.metric);
  const quotaAmount = toSafeInt(quotaReservation.amount, 0);
  if (quotaMetric && quotaAmount > 0) {
    extracted.push({
      metric: quotaMetric,
      provider: "internal",
      model: "quota",
      units: quotaAmount,
      costCents: 0,
      metadata: {
        source: "quotaReservation",
      },
    });
  }

  if (extracted.length === 0) {
    extracted.push({
      metric: defaultMetricForJobType(args.jobType),
      provider: "internal",
      model: args.jobType,
      units: 1,
      costCents: 0,
      metadata: {
        source: "contractFallback",
        contractMissing: true,
        jobType: args.jobType,
      },
    });
  }

  return extracted;
}

export async function settleJobCost(args: SettleJobCostArgs): Promise<{ totalCostCents: number }> {
  const periodKey = getCurrentPeriodKey();
  const period = new Date(Date.UTC(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)) - 1, 1));
  const normalizedEntries = normalizeUsageEntries(args.usageEntries);

  await prisma.$transaction(async (tx) => {
    for (const entry of normalizedEntries) {
      const metadata = entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : Prisma.JsonNull;
      await tx.usage_event.upsert({
        where: {
          jobId_segmentKey: {
            jobId: args.jobId,
            segmentKey: entry.segmentKey,
          },
        },
        update: {},
        create: {
          userId: args.userId,
          projectId: args.projectId,
          jobId: args.jobId,
          period,
          metric: entry.metric,
          provider: entry.provider,
          model: entry.model,
          units: entry.units,
          costCents: entry.costCents,
          segmentKey: entry.segmentKey,
          metadata,
        },
      });
    }

    const allEntries = await tx.usage_event.findMany({
      where: { jobId: args.jobId },
      orderBy: { createdAt: "asc" },
      select: {
        metric: true,
        provider: true,
        model: true,
        units: true,
        costCents: true,
        segmentKey: true,
        metadata: true,
      },
    });

    const totalCostCents = allEntries.reduce((sum, entry) => sum + Number(entry.costCents ?? 0), 0);

    await tx.job.update({
      where: { id: args.jobId },
      data: {
        actualCost: totalCostCents,
        costBreakdown: {
          unit: "cents",
          currency: "USD",
          totalCostCents,
          entries: allEntries,
        } as Prisma.InputJsonValue,
      },
    });
  });

  const settledJob = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: { actualCost: true },
  });

  return { totalCostCents: Number(settledJob?.actualCost ?? 0) };
}
