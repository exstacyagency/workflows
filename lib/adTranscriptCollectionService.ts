import { cfg } from "@/lib/config";
import { prisma } from "./prisma.ts";
import { AdPlatform, JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import pLimit from "p-limit";
import { guardedExternalCall } from "./externalCallGuard.ts";
import { env, requireEnv } from "./configGuard.ts";
import { log } from "@/lib/logger";

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= min ? normalized : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

const ASSEMBLYAI_TIMEOUT_MS = parsePositiveInt(cfg.raw("ASSEMBLYAI_TIMEOUT_MS"), 120_000);
const ASSEMBLYAI_BREAKER_FAILS = parsePositiveInt(cfg.raw("ASSEMBLYAI_BREAKER_FAILS"), 3);
const ASSEMBLYAI_BREAKER_COOLDOWN_MS = parsePositiveInt(cfg.raw("ASSEMBLYAI_BREAKER_COOLDOWN_MS"), 60_000);
const ASSEMBLYAI_MAX_RETRIES = parseNonNegativeInt(cfg.raw("ASSEMBLYAI_RETRIES"), 1);
const ASSEMBLYAI_POLL_INTERVAL_MS = parsePositiveInt(cfg.raw("ASSEMBLYAI_POLL_INTERVAL_MS"), 3_000);

const logger = {
  info(message: string, data: Record<string, unknown>) {
    log(message, data);
  },
};

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
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || !value.trim()) continue;
    const normalized = value.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractMediaUrls(rawJson: unknown): string[] {
  const raw = (rawJson && typeof rawJson === "object" ? rawJson : {}) as Record<string, any>;
  const nestedVideoUrl = raw?.video_info?.video_url;
  const nestedVideoValues =
    nestedVideoUrl && typeof nestedVideoUrl === "object" && !Array.isArray(nestedVideoUrl)
      ? Object.values(nestedVideoUrl).map((value) => firstString(value))
      : [];

  return uniqueStrings([
    firstString(raw?.video_info?.video_url?.["720p"]),
    firstString(raw?.video_info?.video_url?.["1080p"]),
    typeof nestedVideoUrl === "string" ? firstString(nestedVideoUrl) : null,
    ...nestedVideoValues,
    firstString(raw?.video_info?.download_addr),
    firstString(raw?.video_info?.download_url),
    firstString(raw?.video_info?.play_addr),
    firstString(raw?.video_info?.play_url),
    firstString(raw?.url),
    firstString(raw?.videoUrl),
    firstString(raw?.mediaUrl),
    firstString(raw?.audioUrl),
  ]);
}

function getAssemblyAiApiKey() {
  requireEnv(["ASSEMBLYAI_API_KEY"], "AssemblyAI");
  return env("ASSEMBLYAI_API_KEY")!;
}

async function createAssemblyAiClient() {
  const apiKey = getAssemblyAiApiKey();
  try {
    const { AssemblyAI } = await import("assemblyai");
    return new AssemblyAI({ apiKey });
  } catch {
    throw new Error("AssemblyAI SDK not installed. Run `npm install assemblyai` and restart.");
  }
}

function isAssemblyAiRetryable(err: any) {
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

function normalizeAssemblyAiWords(raw: unknown): TranscriptWord[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const word = entry as Record<string, unknown>;
      const text = firstString(word.text, word.word, word.token);
      if (!text) return null;

      const start = firstNumber(word.start, word.start_ms, word.startMs) ?? 0;
      const end = firstNumber(word.end, word.end_ms, word.endMs) ?? start;

      return {
        text,
        start: Math.max(0, Math.round(start)),
        end: Math.max(Math.round(start), Math.round(end)),
      } satisfies TranscriptWord;
    })
    .filter((w): w is TranscriptWord => Boolean(w));
}

async function transcribeWithAssemblyAi(mediaUrl: string): Promise<{
  text: string;
  words: TranscriptWord[];
  transcriptId: string | null;
  status: string | null;
  confidence: number | null;
  audioDuration: number | null;
}> {
  const client = await createAssemblyAiClient();
  const transcript = (await guardedExternalCall({
    breakerKey: "assemblyai:ad-transcripts",
    breaker: { failureThreshold: ASSEMBLYAI_BREAKER_FAILS, cooldownMs: ASSEMBLYAI_BREAKER_COOLDOWN_MS },
    timeoutMs: ASSEMBLYAI_TIMEOUT_MS,
    retry: { retries: ASSEMBLYAI_MAX_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
    label: "AssemblyAI transcript run",
    fn: async () => client.transcripts.transcribe({ audio: mediaUrl }),
    isRetryable: isAssemblyAiRetryable,
  })) as Record<string, unknown>;

  return {
    text: firstString(transcript.text) ?? "",
    words: normalizeAssemblyAiWords(transcript.words),
    transcriptId: firstString(transcript.id),
    status: firstString(transcript.status),
    confidence: firstNumber(transcript.confidence),
    audioDuration: firstNumber(transcript.audio_duration),
  };
}

async function transcribeWithAssemblyAiCandidates(mediaUrls: string[]): Promise<{
  text: string;
  words: TranscriptWord[];
  transcriptId: string | null;
  status: string | null;
  confidence: number | null;
  audioDuration: number | null;
  mediaUrl: string;
}> {
  let lastError: string = "AssemblyAI failed";
  for (const mediaUrl of mediaUrls) {
    try {
      const result = await transcribeWithAssemblyAi(mediaUrl);
      return { ...result, mediaUrl };
    } catch (error: any) {
      lastError = String(error?.message ?? error);
    }
  }
  throw new Error(lastError);
}

function isMusicLyrics(text: string): boolean {
  const lowerText = text.toLowerCase();
  const musicKeywords = ["verse", "chorus", "bridge", "instrumental", "lyrics"];
  const matchCount = musicKeywords.filter((k) => lowerText.includes(k)).length;
  return matchCount >= 2;
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

  if (!asset) return "skipped" as const;
  const existingTranscript = (asset.rawJson as any)?.transcript;
  if (existingTranscript && String(existingTranscript).trim().length > 0) return "skipped" as const;

  const mediaUrls = extractMediaUrls(asset.rawJson);
  if (mediaUrls.length === 0) return "skipped" as const;

  const transcript = await transcribeWithAssemblyAiCandidates(mediaUrls);
  const text = transcript.text.trim();
  if (text.length < 10) {
    const noSpeechRawJson = {
      ...(asset.rawJson as any),
      transcript: "",
      transcriptWords: [],
      transcriptSource: {
        provider: "assemblyai",
        transcriptId: transcript.transcriptId,
        status: "NO_SPEECH",
        confidence: transcript.confidence,
        mediaUrl: transcript.mediaUrl,
      },
      metrics: {
        ...((asset.rawJson as any)?.metrics || {}),
        transcript_meta: {
          trigger_word_count: 0,
          first_trigger_time: null,
          trigger_density: 0,
        },
        transcript_provider: "assemblyai",
      },
    };

    await prisma.adAsset.update({
      where: { id: asset.id },
      data: { rawJson: noSpeechRawJson as any },
    });

    return "no_speech" as const;
  }
  if (isMusicLyrics(text)) return "skipped" as const;

  const duration = firstNumber(
    (asset.rawJson as any)?.metrics?.duration,
    (asset.rawJson as any)?.video_info?.duration,
    transcript.audioDuration
  );

  const words = transcript.words;
  const meta = computeTranscriptMeta(text, words, duration);

  let mergedMetrics: any = (asset.rawJson as any)?.metrics || {};
  mergedMetrics = {
    ...mergedMetrics,
    transcript_meta: meta,
    transcript_provider: "assemblyai",
  };

  const newRawJson = {
    ...(asset.rawJson as any),
    transcript: text,
    transcriptWords: words,
    transcriptSource: {
      provider: "assemblyai",
      transcriptId: transcript.transcriptId,
      status: transcript.status,
      confidence: transcript.confidence,
      mediaUrl: transcript.mediaUrl,
    },
    metrics: mergedMetrics,
  };

  await prisma.adAsset.update({
    where: { id: asset.id },
    data: { rawJson: newRawJson as any },
  });

  return "transcribed" as const;
}

export async function runAdTranscriptCollection(args: {
  projectId: string;
  jobId: string;
  runId: string;
  forceReprocess?: boolean;
  onProgress?: (pct: number) => void;
}) {
  const { projectId, runId, forceReprocess = false, onProgress } = args;
  requireEnv(["ASSEMBLYAI_API_KEY"], "AssemblyAI");

  if (!runId || !String(runId).trim()) {
    throw new Error("runId is required for transcript collection");
  }

  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
      job: {
        is: {
          runId,
        },
      },
    },
    select: { id: true, rawJson: true },
  });

  const assetsToProcess = forceReprocess
    ? assets
    : assets.filter((a) => {
        const t = (a.rawJson as any)?.transcript;
        return !t || String(t).trim() === "";
      });

  if (!assetsToProcess.length) {
    return { totalAssets: 0, processed: 0 };
  }

  let processed = 0;
  let noSpeech = 0;
  let skipped = 0;
  let completed = 0;
  const total = assetsToProcess.length;
  const errors: Array<{ assetId: string; error: any }> = [];

  const promises = assetsToProcess.map((asset) =>
    limit(async () => {
      try {
        const result = await enrichAssetWithTranscript(asset.id);
        if (result === "transcribed") processed++;
        if (result === "no_speech") noSpeech++;
        if (result === "skipped") skipped++;
        completed++;
        if (onProgress) {
          onProgress(Math.floor((completed / total) * 100));
        }
      } catch (err) {
        errors.push({ assetId: asset.id, error: err });
        completed++;
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

  return { totalAssets: total, processed, noSpeech, skipped };
}

export async function startAdTranscriptJob(params: {
  projectId: string;
  jobId: string;
  runId: string;
  forceReprocess?: boolean;
}) {
  const { projectId, jobId, runId, forceReprocess } = params;
  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  if (!currentJob) {
    throw new Error(`Transcript job not found: ${jobId}`);
  }

  if (currentJob.status === JobStatus.RUNNING) {
    console.log("[Transcript] Job already running, skipping status update", { jobId });
  } else {
    await updateJobStatus(jobId, JobStatus.RUNNING);
  }
  logger.info("[Transcript] Config loaded", {
    jobId,
    timeoutMs: ASSEMBLYAI_TIMEOUT_MS,
    maxRetries: ASSEMBLYAI_MAX_RETRIES,
    pollIntervalMs: ASSEMBLYAI_POLL_INTERVAL_MS,
  });

  try {
    const result = await runAdTranscriptCollection({
      projectId,
      jobId,
      runId,
      forceReprocess,
    });

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `Transcripts: ${result.processed}/${result.totalAssets} (no_speech: ${result.noSpeech ?? 0}, skipped: ${result.skipped ?? 0})`,
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
