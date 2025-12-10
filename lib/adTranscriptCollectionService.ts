// lib/adTranscriptCollectionService.ts
import prisma from '@/lib/prisma';
import { AdPlatform, JobStatus, JobType } from '@prisma/client';

type AssemblyTranscript = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: { text: string; start: number; end: number }[];
  error?: string;
  [key: string]: any;
};

const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';

const TRIGGER_WORDS = [
  'serum',
  'cream',
  'cleanser',
  'moisturizer',
  'toner',
  'mask',
  'acne',
  'wrinkles',
  'dark spots',
  'dryness',
  'aging',
  'pores',
  'clear',
  'smooth',
  'glow',
  'firm',
  'hydrate',
  'reduce',
];

function isMusicLyrics(text: string): boolean {
  if (!text || text.length < 20) return false;
  const words = text.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);

  // High repetition ratio
  if (words.length / uniqueWords.size > 2.5) return true;

  const shortWords = words.filter(w => w.length <= 4).length;
  // Lyrics often have tons of short words and repetition
  if (shortWords / words.length > 0.7) return true;

  return false;
}

function getAssemblyHeaders() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is not set');
  }
  return {
    authorization: apiKey,
    'content-type': 'application/json',
  };
}

/**
 * Kick off a transcription job for a single ad asset.
 */
async function startTranscriptForAsset(audioUrl: string): Promise<string> {
  const res = await fetch(`${ASSEMBLY_BASE}/transcript`, {
    method: 'POST',
    headers: getAssemblyHeaders(),
    body: JSON.stringify({
      audio_url: audioUrl,
      language_detection: true,
      word_boost: [],
      boost_param: 'default',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AssemblyAI create transcript failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Poll a transcription job until it completes or errors, with max retries.
 */
async function pollTranscript(transcriptId: string, maxRetries = 20, delayMs = 10000): Promise<AssemblyTranscript> {
  let retries = 0;

  while (retries < maxRetries) {
    const res = await fetch(`${ASSEMBLY_BASE}/transcript/${transcriptId}`, {
      method: 'GET',
      headers: getAssemblyHeaders(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AssemblyAI poll failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as AssemblyTranscript;

    if (data.status === 'completed' || data.status === 'error') {
      return data;
    }

    // Not done yet, wait and retry
    retries += 1;
    await new Promise(r => setTimeout(r, delayMs));
  }

  return {
    id: transcriptId,
    status: 'error',
    error: 'timeout',
  } as AssemblyTranscript;
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
  const first_trigger_time =
    mentions.length > 0 ? mentions[0].start / 1000 : null;
  const d = duration && duration > 0 ? duration : 1;
  const trigger_density = trigger_word_count / d;

  return {
    trigger_word_count,
    first_trigger_time,
    trigger_density,
  };
}

/**
 * Main worker: enriches a single AdAsset with transcript (if valid).
 */
async function enrichAssetWithTranscript(assetId: string) {
  const asset = await prisma.adAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) return;
  if (asset.transcript && asset.transcript.trim().length > 0) {
    // Already has transcript; skip
    return;
  }

  const audioUrl = asset.url;
  if (!audioUrl) {
    return;
  }

  // 1) Start transcript job
  const transcriptId = await startTranscriptForAsset(audioUrl);

  // 2) Poll until completed or error
  const transcript = await pollTranscript(transcriptId);

  if (transcript.status !== 'completed') {
    // You could log transcript.error here if needed
    return;
  }

  const text = transcript.text || '';
  const words = transcript.words || [];

  // Filters from workflow
  if (text.length < 10) {
    return;
  }
  if (isMusicLyrics(text)) {
    return;
  }

  // 3) Compute transcript metadata
  const duration =
    typeof asset.metrics === 'object' && asset.metrics
      ? (asset.metrics as any).duration ?? null
      : null;

  const meta = computeTranscriptMeta(text, words, duration as number | null);

  // 4) Merge transcript meta into existing metrics
  let mergedMetrics: any = asset.metrics || {};
  mergedMetrics = {
    ...mergedMetrics,
    transcript_meta: meta,
  };

  // 5) Save transcript + metrics back to AdAsset
  await prisma.adAsset.update({
    where: { id: asset.id },
    data: {
      transcript: text,
      metrics: mergedMetrics,
    },
  });
}

/**
 * Orchestrator: run transcript collection for a project.
 */
export async function runAdTranscriptCollection(args: {
  projectId: string;
  jobId: string;
}) {
  const { projectId, jobId } = args;

  // Find TikTok ads for this project that don't have transcript yet
  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
      OR: [{ transcript: null }, { transcript: '' }],
    },
    select: { id: true },
  });

  if (!assets.length) {
    return {
      totalAssets: 0,
      processed: 0,
    };
  }

  let processed = 0;

  for (const a of assets) {
    try {
      await enrichAssetWithTranscript(a.id);
      processed += 1;
    } catch (err) {
      // Don't fail the whole job for a single asset; just continue
      console.error(`Error enriching asset ${a.id}:`, err);
    }
  }

  return {
    totalAssets: assets.length,
    processed,
  };
}

/**
 * Convenience wrapper that creates a Job row, runs the pipeline,
 * updates status and summary, and returns a simple result.
 */
export async function startAdTranscriptJob(params: { projectId: string }) {
  const { projectId } = params;

  const job = await prisma.job.create({
    data: {
      type: JobType.AD_PERFORMANCE, // reuse AD_PERFORMANCE or add a specific AD_TRANSCRIPT if you want
      status: JobStatus.RUNNING,
      projectId,
      payload: { projectId, kind: 'ad_transcript_collection' },
    },
  });

  try {
    const result = await runAdTranscriptCollection({
      projectId,
      jobId: job.id,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Transcript collection complete: ${result.processed}/${result.totalAssets} assets enriched`,
      },
    });

    return { jobId: job.id, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error in transcript collection',
      },
    });
    throw err;
  }
}
