import { prisma } from '@/lib/prisma';
import { AdPlatform, JobStatus } from '@prisma/client';
import pLimit from 'p-limit';

const ASSEMBLY_BASE = 'https://api.assemblyai.com/v2';
const TRIGGER_WORDS = ['you', 'your', 'yourself'];

const limit = pLimit(10);

function getAssemblyHeaders() {
  return {
    authorization: process.env.ASSEMBLYAI_API_KEY || '',
    'content-type': 'application/json',
  };
}

async function startTranscriptForAsset(audioUrl: string): Promise<string> {
  const res = await fetch(`${ASSEMBLY_BASE}/transcript`, {
    method: 'POST',
    headers: getAssemblyHeaders(),
    body: JSON.stringify({ audio_url: audioUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AssemblyAI start failed: ${res.status} ${text}`);
  }

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

  if (transcript.status !== 'completed') return;

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

  const promises = assets.map((asset) =>
    limit(async () => {
      try {
        await enrichAssetWithTranscript(asset.id);
        processed++;
        if (onProgress) {
          onProgress(Math.floor((processed / total) * 100));
        }
      } catch (err) {
        console.error(`Asset ${asset.id} failed:`, err);
      }
    })
  );

  await Promise.all(promises);

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
