import { cfg } from "@/lib/config";
import { prisma } from "./prisma.ts";
import { AdPlatform, JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import pLimit from "p-limit";
import { guardedExternalCall } from "./externalCallGuard.ts";
import { env, requireEnv } from "./configGuard.ts";

const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_TIMEOUT_MS = Number(cfg.raw("APIFY_TIMEOUT_MS") ?? 30_000);
const APIFY_BREAKER_FAILS = Number(cfg.raw("APIFY_BREAKER_FAILS") ?? 3);
const APIFY_BREAKER_COOLDOWN_MS = Number(cfg.raw("APIFY_BREAKER_COOLDOWN_MS") ?? 60_000);
const APIFY_RETRIES = Number(cfg.raw("APIFY_RETRIES") ?? 1);
const APIFY_WAIT_FOR_FINISH_SECS = Number(cfg.raw("APIFY_TRANSCRIPT_WAIT_SECS") ?? 180);
const APIFY_TRANSCRIPT_ACTOR_ID_DEFAULT = "gE6MpI4jJF4h5mahj";

const TRIGGER_WORDS = ["you", "your", "yourself"];
const limit = pLimit(5);

type TranscriptWord = { text: string; start: number; end: number };

type TranscriptMeta = {
  trigger_word_count: number;
  first_trigger_time: number | null;
  trigger_density: number;
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getApifyToken() {
  requireEnv(["APIFY_API_TOKEN"], "APIFY");
  return env("APIFY_API_TOKEN")!;
}

function getTranscriptActorId() {
  return env("APIFY_AD_TRANSCRIPT_ACTOR_ID") ?? APIFY_TRANSCRIPT_ACTOR_ID_DEFAULT;
}

function isApifyRetryable(err: any) {
  const msg = String(err?.message ?? err).toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504")
  );
}

async function readTextSafely(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function fetchApifyDatasetItems(datasetId: string, token: string): Promise<any[]> {
  const url = new URL(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set("token", token);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");

  const res = await guardedExternalCall({
    breakerKey: "apify:ad-transcripts",
    breaker: { failureThreshold: APIFY_BREAKER_FAILS, cooldownMs: APIFY_BREAKER_COOLDOWN_MS },
    timeoutMs: APIFY_TIMEOUT_MS,
    retry: { retries: APIFY_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
    label: "Apify transcript dataset",
    fn: async () => {
      const response = await fetch(url.toString(), { method: "GET" });
      if (!response.ok) {
        const body = await readTextSafely(response);
        throw new Error(`Apify transcript dataset failed: ${response.status} ${body}`);
      }
      return response;
    },
    isRetryable: isApifyRetryable,
  });

  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

async function runTranscriptActorForMedia(mediaUrl: string): Promise<{
  item: Record<string, unknown>;
  actorId: string;
  runId: string | null;
  datasetId: string | null;
}> {
  const token = getApifyToken();
  const actorId = getTranscriptActorId();

  const input: Record<string, unknown> = {
    url: mediaUrl,
    videoUrl: mediaUrl,
    urls: [mediaUrl],
    videoUrls: [mediaUrl],
    startUrls: [{ url: mediaUrl }],
    maxItems: 1,
  };

  const url = new URL(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs`);
  url.searchParams.set("token", token);
  url.searchParams.set("waitForFinish", String(APIFY_WAIT_FOR_FINISH_SECS));

  const runRes = await guardedExternalCall({
    breakerKey: "apify:ad-transcripts",
    breaker: { failureThreshold: APIFY_BREAKER_FAILS, cooldownMs: APIFY_BREAKER_COOLDOWN_MS },
    timeoutMs: APIFY_TIMEOUT_MS,
    retry: { retries: APIFY_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
    label: "Apify transcript run",
    fn: async () => {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await readTextSafely(response);
        throw new Error(`Apify transcript run failed: ${response.status} ${body}`);
      }
      return response;
    },
    isRetryable: isApifyRetryable,
  });

  const runData = (await runRes.json()) as any;
  const run = runData?.data ?? runData ?? {};
  const runId = firstString(run?.id);
  const datasetId = firstString(run?.defaultDatasetId);

  if (!datasetId) {
    throw new Error(`Apify transcript run missing defaultDatasetId (actor=${actorId}, runId=${runId ?? "unknown"})`);
  }

  const items = await fetchApifyDatasetItems(datasetId, token);
  const first = items.find((item) => isPlainObject(item));
  if (!first) {
    throw new Error(`Apify transcript actor returned no items (actor=${actorId}, runId=${runId ?? "unknown"})`);
  }

  return {
    item: first as Record<string, unknown>,
    actorId,
    runId,
    datasetId,
  };
}

function isMusicLyrics(text: string): boolean {
  const lowerText = text.toLowerCase();
  const musicKeywords = ["verse", "chorus", "bridge", "instrumental", "lyrics"];
  const matchCount = musicKeywords.filter((k) => lowerText.includes(k)).length;
  return matchCount >= 2;
}

function normalizeTranscriptWords(raw: unknown, duration: number | null): TranscriptWord[] {
  if (!Array.isArray(raw)) return [];

  const maxSecondsHint = duration && duration > 0 && duration < 10_000 ? duration : null;

  return raw
    .map((entry) => {
      if (!isPlainObject(entry)) return null;
      const text = firstString(entry.text, entry.word, entry.token);
      if (!text) return null;

      let start = firstNumber(entry.start, entry.start_ms, entry.startMs, entry.s, entry.from) ?? 0;
      let end = firstNumber(entry.end, entry.end_ms, entry.endMs, entry.e, entry.to) ?? start;

      // If timestamps look like seconds (small numbers), convert to ms for downstream meta logic.
      if (maxSecondsHint && start <= maxSecondsHint + 2 && end <= maxSecondsHint + 2) {
        start *= 1000;
        end *= 1000;
      }

      return {
        text,
        start: Math.max(0, Math.round(start)),
        end: Math.max(Math.round(start), Math.round(end)),
      } satisfies TranscriptWord;
    })
    .filter((w): w is TranscriptWord => Boolean(w));
}

function extractTranscriptText(item: Record<string, unknown>): string {
  const direct = firstString(
    item.transcript,
    item.text,
    item.transcription,
    item.caption,
    item.captions,
    item.subtitle,
    item.subtitles,
    item.output,
    item.result
  );
  if (direct) return direct;

  const segments = [
    item.segments,
    item.transcriptSegments,
    item.transcript_segments,
    item.sentences,
    item.lines,
  ];

  for (const segmentValue of segments) {
    if (!Array.isArray(segmentValue)) continue;
    const text = segmentValue
      .map((segment) => {
        if (typeof segment === "string") return segment.trim();
        if (!isPlainObject(segment)) return "";
        return firstString(segment.text, segment.caption, segment.value) ?? "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();

    if (text) return text;
  }

  if (Array.isArray(item.words)) {
    const text = item.words
      .map((w) => {
        if (typeof w === "string") return w.trim();
        if (!isPlainObject(w)) return "";
        return firstString(w.text, w.word, w.token) ?? "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }

  return "";
}

function computeTranscriptMeta(
  text: string,
  words: TranscriptWord[] | undefined,
  duration: number | null
): TranscriptMeta {
  if (!text || !words || !words.length) {
    return {
      trigger_word_count: 0,
      first_trigger_time: null,
      trigger_density: 0,
    };
  }

  const mentions = words.filter((w) =>
    TRIGGER_WORDS.some((k) => w.text?.toLowerCase().includes(k))
  );

  const trigger_word_count = mentions.length;
  const first_trigger_time = mentions.length > 0 ? mentions[0].start / 1000 : null;
  const d = duration && duration > 0 ? duration : 1;
  const trigger_density = trigger_word_count / d;

  return {
    trigger_word_count,
    first_trigger_time,
    trigger_density,
  };
}

async function enrichAssetWithTranscript(assetId: string) {
  const asset = await prisma.adAsset.findUnique({
    where: { id: assetId },
    select: { id: true, rawJson: true },
  });

  if (!asset) return;
  const existingTranscript = (asset.rawJson as any)?.transcript;
  if (existingTranscript && String(existingTranscript).trim().length > 0) return;

  const mediaUrl =
    firstString(
      (asset.rawJson as any)?.url,
      (asset.rawJson as any)?.audioUrl,
      (asset.rawJson as any)?.mediaUrl,
      (asset.rawJson as any)?.videoUrl,
      (asset.rawJson as any)?.video_info?.video_url?.["720p"],
      (asset.rawJson as any)?.video_info?.video_url?.["1080p"]
    ) ?? null;

  if (!mediaUrl) return;

  const { item, actorId, runId, datasetId } = await runTranscriptActorForMedia(mediaUrl);
  const text = extractTranscriptText(item);

  if (text.length < 10) return;
  if (isMusicLyrics(text)) return;

  const duration = firstNumber(
    (asset.rawJson as any)?.metrics?.duration,
    (asset.rawJson as any)?.video_info?.duration,
    item.duration,
    item.videoDuration,
    item.video_duration
  );

  const words = normalizeTranscriptWords(item.words, duration);
  const meta = computeTranscriptMeta(text, words, duration);

  let mergedMetrics: any = (asset.rawJson as any)?.metrics || {};
  mergedMetrics = {
    ...mergedMetrics,
    transcript_meta: meta,
    transcript_provider: "apify",
  };

  const newRawJson = {
    ...(asset.rawJson as any),
    transcript: text,
    transcriptWords: words,
    transcriptSource: {
      provider: "apify",
      actorId,
      runId,
      datasetId,
      mediaUrl,
    },
    metrics: mergedMetrics,
  };

  await prisma.adAsset.update({
    where: { id: asset.id },
    data: {
      rawJson: newRawJson as any,
    },
  });
}

export async function runAdTranscriptCollection(args: {
  projectId: string;
  jobId: string;
  onProgress?: (pct: number) => void;
}) {
  const { projectId, jobId, onProgress } = args;

  requireEnv(["APIFY_API_TOKEN"], "APIFY");

  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
    },
    select: { id: true, rawJson: true },
  });

  const assetsToProcess = assets.filter((a) => {
    const t = (a.rawJson as any)?.transcript;
    return !t || String(t).trim() === "";
  });

  if (!assetsToProcess.length) {
    return { totalAssets: 0, processed: 0 };
  }

  let processed = 0;
  const total = assetsToProcess.length;
  const errors: Array<{ assetId: string; error: any }> = [];

  const promises = assetsToProcess.map((asset) =>
    limit(async () => {
      try {
        await enrichAssetWithTranscript(asset.id);
        processed++;
        if (onProgress) {
          onProgress(Math.floor((processed / total) * 100));
        }
      } catch (err) {
        errors.push({ assetId: asset.id, error: err });
      }
    })
  );

  await Promise.all(promises);

  if (errors.length > 0) {
    const first = errors[0];
    const firstMsg = String(first?.error?.message ?? first?.error ?? "Unknown error");
    throw new Error(
      `Transcript collection failed for ${errors.length}/${total} assets (first ${first.assetId}: ${firstMsg})`
    );
  }

  return { totalAssets: total, processed };
}

export async function startAdTranscriptJob(params: {
  projectId: string;
  jobId: string;
}) {
  const { projectId, jobId } = params;
  await updateJobStatus(jobId, JobStatus.RUNNING);
  try {
    const result = await runAdTranscriptCollection({
      projectId,
      jobId,
    });

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `Transcripts: ${result.processed}/${result.totalAssets}`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err?.message ?? "Unknown error in transcript collection",
      },
    });
    throw err;
  }
}
