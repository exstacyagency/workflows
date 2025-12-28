import { cfg } from "@/lib/config";
import { prisma } from './prisma.ts';
import { AdPlatform, JobStatus } from '@prisma/client';
import pLimit from 'p-limit';
import { guardedExternalCall } from './externalCallGuard.ts';
import { env, requireEnv } from './configGuard.ts';

const APIFY_TIMEOUT_MS = Number(cfg.raw("APIFY_TIMEOUT_MS") ?? 30_000);
const APIFY_BREAKER_FAILS = Number(cfg.raw("APIFY_BREAKER_FAILS") ?? 3);
const APIFY_BREAKER_COOLDOWN_MS = Number(cfg.raw("APIFY_BREAKER_COOLDOWN_MS") ?? 60_000);
const APIFY_RETRIES = Number(cfg.raw("APIFY_RETRIES") ?? 1);

const ASSEMBLY_TIMEOUT_MS = Number(cfg.raw("ASSEMBLY_TIMEOUT_MS") ?? APIFY_TIMEOUT_MS);
const ASSEMBLY_BREAKER_FAILS = Number(cfg.raw("ASSEMBLY_BREAKER_FAILS") ?? APIFY_BREAKER_FAILS);
const ASSEMBLY_BREAKER_COOLDOWN_MS = Number(
  cfg.raw("ASSEMBLY_BREAKER_COOLDOWN_MS") ?? APIFY_BREAKER_COOLDOWN_MS
);
const ASSEMBLY_RETRIES = Number(cfg.raw("ASSEMBLY_RETRIES") ?? APIFY_RETRIES);

const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';
const TRIGGER_WORDS = ['you', 'your', 'yourself'];

const limit = pLimit(10);

function getAssemblyHeaders() {
  requireEnv(['ASSEMBLYAI_API_KEY'], 'ASSEMBLYAI');
  const apiKey = env('ASSEMBLYAI_API_KEY')!;
  return {
    authorization: apiKey,
    'content-type': 'application/json',
  };
}

function isAssemblyRetryable(err: any) {
  const msg = String(err?.message ?? err).toLowerCase();
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504')
  );
}

async function startTranscriptForAsset(audioUrl: string): Promise<string> {
  const headers = getAssemblyHeaders();
  const res = await guardedExternalCall({
    breakerKey: 'assemblyai:ad-transcripts',
    breaker: { failureThreshold: ASSEMBLY_BREAKER_FAILS, cooldownMs: ASSEMBLY_BREAKER_COOLDOWN_MS },
    timeoutMs: ASSEMBLY_TIMEOUT_MS,
    retry: { retries: ASSEMBLY_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
    label: 'AssemblyAI start transcript',
    fn: async () => {
      const r = await fetch(`${ASSEMBLY_BASE}/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ audio_url: audioUrl }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`AssemblyAI HTTP ${r.status}: ${body}`);
      }

      return r;
    },
    isRetryable: isAssemblyRetryable,
  });

  const data = await res.json();
  return data.id;
}

type AssemblyTranscript = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: { text: string; start: number; end: number }[];
  error?: string;
};

async function pollTranscript(transcriptId: string, maxRetries = 20, delayMs = 10000): Promise<AssemblyTranscript> {
  let retries = 0;

  const headers = getAssemblyHeaders();
  while (retries < maxRetries) {
    const res = await guardedExternalCall({
      breakerKey: 'assemblyai:ad-transcripts',
      breaker: { failureThreshold: ASSEMBLY_BREAKER_FAILS, cooldownMs: ASSEMBLY_BREAKER_COOLDOWN_MS },
      timeoutMs: ASSEMBLY_TIMEOUT_MS,
      retry: { retries: ASSEMBLY_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
      label: 'AssemblyAI poll transcript',
      fn: async () => {
        const r = await fetch(`${ASSEMBLY_BASE}/transcript/${transcriptId}`, {
          method: 'GET',
          headers,
        });

        if (!r.ok) {
          const body = await r.text().catch(() => '');
          throw new Error(`AssemblyAI HTTP ${r.status}: ${body}`);
        }

        return r;
      },
      isRetryable: isAssemblyRetryable,
    });

    const data = (await res.json()) as AssemblyTranscript;

    if (data.status === 'completed' || data.status === 'error') {
      return data;
    }

    retries += 1;
    await new Promise(r => setTimeout(r, delayMs));
  }

  return {
    id: transcriptId,
    status: 'error',
    error: 'timeout',
  } as AssemblyTranscript;
}

function isMusicLyrics(text: string): boolean {
  const lowerText = text.toLowerCase();
  const musicKeywords = ['verse', 'chorus', 'bridge', 'instrumental', 'lyrics'];
  const matchCount = musicKeywords.filter(k => lowerText.includes(k)).length;
  return matchCount >= 2;
}

type TranscriptMeta = {
  trigger_word_count: number;
  first_trigger_time: number | null;
  trigger_density: number;
};

function computeTranscriptMeta(
  text: string,
  words: { text: string; start: number; end: number }[] | undefined,
  duration: number | null,
): TranscriptMeta {
  if (!text || !words || !words.length) {
    return {
      trigger_word_count: 0,
      first_trigger_time: null,
      trigger_density: 0,
    };
  }

  const mentions = words.filter(w =>
    TRIGGER_WORDS.some(k => w.text?.toLowerCase().includes(k)),
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
  });

  if (!asset) return;
  if (asset.transcript && asset.transcript.trim().length > 0) return;

  const audioUrl = asset.url;
  if (!audioUrl) return;

  const transcriptId = await startTranscriptForAsset(audioUrl);
  const transcript = await pollTranscript(transcriptId);

  if (transcript.status !== 'completed') {
    throw new Error(`AssemblyAI transcript ${transcript.status}: ${transcript.error ?? 'unknown error'}`);
  }

  const text = transcript.text || '';
  const words = transcript.words || [];

  if (text.length < 10) return;
  if (isMusicLyrics(text)) return;

  const duration =
    typeof asset.metrics === 'object' && asset.metrics
      ? (asset.metrics as any).duration ?? null
      : null;

  const meta = computeTranscriptMeta(text, words, duration as number | null);

  let mergedMetrics: any = asset.metrics || {};
  mergedMetrics = {
    ...mergedMetrics,
    transcript_meta: meta,
  };

  await prisma.adAsset.update({
    where: { id: asset.id },
    data: {
      transcript: text,
      metrics: mergedMetrics,
    },
  });
}

export async function runAdTranscriptCollection(args: {
  projectId: string;
  jobId: string;
  onProgress?: (pct: number) => void;
}) {
  const { projectId, jobId, onProgress } = args;

  requireEnv(['ASSEMBLYAI_API_KEY'], 'ASSEMBLYAI');

  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
      OR: [{ transcript: null }, { transcript: '' }],
    },
    select: { id: true },
  });

  if (!assets.length) {
    return { totalAssets: 0, processed: 0 };
  }

  let processed = 0;
  const total = assets.length;
  const errors: Array<{ assetId: string; error: any }> = [];

  const promises = assets.map((asset) =>
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
    const firstMsg = String(first?.error?.message ?? first?.error ?? 'Unknown error');
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
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING },
  });
  try {
    const result = await runAdTranscriptCollection({
      projectId,
      jobId,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Transcripts: ${result.processed}/${result.totalAssets}`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error in transcript collection',
      },
    });
    throw err;
  }
}
