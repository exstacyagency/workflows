// lib/adRawCollectionService.ts
import prisma from '@/lib/prisma';
import { AdPlatform, JobStatus, Prisma } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';

const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_POLL_MS = 2000;
const APIFY_MAX_WAIT_MS = 120_000;

type ApifyAd = {
  id: string;
  video_info?: {
    video_url?: Record<string, string>;
    duration?: number;
  };
  keyframe_metrics?: {
    play_retain_cnt?: {
      analysis?: { second: number; value: number }[];
    };
    convert_cnt?: {
      analysis?: { second: number; value: number }[];
      highlight?: any;
    };
  };
  ctr?: number;
  cost?: number;
  like?: number;
  ad_title?: string;
  // TikTok might have its own transcript/ocr in some cases
  text?: string;
  ocr_text?: string | null;
  [key: string]: any;
};

type NormalizedAd = {
  id: string;
  videoUrl: string;
  retention3s: number;
  retention10s: number;
  duration: number;
  ctr: number | null;
  cost: number | null;
  like: number | null;
  adTitle: string | null;
  playRetainCnt: any;
  convertCnt: any;
  conversionSpikes: any;
};

type JobNormalizedAd = {
  source: 'apify';
  adId: string | null;
  platform: string | null;
  pageName: string | null;
  brand: string | null;
  createdAt: string | null;
  text: string | null;
  mediaUrl: string | null;
  landingUrl: string | null;
  metrics: Record<string, any> | null;
  raw: Record<string, any>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readTextSafely(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function asPlainObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return {};
}

function asRawObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return { value };
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) return s;
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseDateToIso(value: unknown): string | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const ms = firstNumber(value);
  if (ms === null) return null;
  const asMs = ms > 10_000_000_000 ? ms : ms * 1000;
  return new Date(asMs).toISOString();
}

export async function fetchDatasetItems(datasetId: string): Promise<any[]> {
  requireEnv(['APIFY_API_TOKEN'], 'APIFY');
  const token = env('APIFY_API_TOKEN')!;

  const url = new URL(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set('token', token);
  url.searchParams.set('clean', 'true');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    const text = await readTextSafely(res);
    throw new Error(`Apify dataset request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  return Array.isArray(data) ? data : [];
}

export async function waitForApifyRun(runId: string): Promise<string> {
  requireEnv(['APIFY_API_TOKEN'], 'APIFY');
  const token = env('APIFY_API_TOKEN')!;

  const deadlineMs = Date.now() + APIFY_MAX_WAIT_MS;
  while (true) {
    const url = new URL(`${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}`);
    url.searchParams.set('token', token);

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) {
      const text = await readTextSafely(res);
      throw new Error(`Apify run status failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as any;
    const status = String(data?.data?.status ?? '');
    const datasetId = String(data?.data?.defaultDatasetId ?? '');

    if (status === 'SUCCEEDED') {
      if (!datasetId) throw new Error('Apify run succeeded but defaultDatasetId is missing');
      return datasetId;
    }

    if (status === 'FAILED' || status === 'TIMED-OUT' || status === 'ABORTED') {
      const msg = firstString(data?.data?.statusMessage);
      throw new Error(`Apify run ended with status=${status}${msg ? `: ${msg}` : ''}`);
    }

    if (Date.now() > deadlineMs) {
      throw new Error(`Apify run polling timed out after ${Math.floor(APIFY_MAX_WAIT_MS / 1000)}s (runId=${runId})`);
    }

    await sleep(APIFY_POLL_MS);
  }
}

export async function runApifyActor(input: Record<string, unknown>): Promise<{ runId: string; datasetId: string }> {
  requireEnv(['APIFY_API_TOKEN', 'APIFY_ACTOR_ID'], 'APIFY');
  const token = env('APIFY_API_TOKEN')!;
  const actorId = env('APIFY_ACTOR_ID')!;

  const url = new URL(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs`);
  url.searchParams.set('token', token);
  url.searchParams.set('waitForFinish', '0');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await readTextSafely(res);
    throw new Error(`Apify run start failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;
  const runId = firstString(data?.data?.id);
  if (!runId) throw new Error('Apify run start did not return a runId');

  const datasetId = await waitForApifyRun(runId);
  return { runId, datasetId };
}

function extractRetention(
  playArr: { second: number; value: number }[] | undefined,
  second: number,
): number {
  if (!playArr) return 0;
  const hit = playArr.find(a => a.second === second);
  return hit?.value ?? 0;
}

/**
 * Fetch raw ads from Apify dataset.
 * The n8n workflow builds an input payload for an Apify actor, but here
 * we simplify: we fetch items from a dataset ID and then filter/normalize in code.
 */
async function fetchApifyAds(options: {
  industryCode: string;
  projectId: string;
}): Promise<{ items: ApifyAd[]; actorId: string | null; runId: string | null; datasetId: string }> {
  requireEnv(['APIFY_API_TOKEN', 'APIFY_ACTOR_ID'], 'APIFY');
  
  const actorId = env('APIFY_ACTOR_ID')!;
  const { runId, datasetId } = await runApifyActor({
    industryCode: options.industryCode,
    projectId: options.projectId,
  });
  const items = (await fetchDatasetItems(datasetId)) as ApifyAd[];
  return { items, actorId, runId, datasetId };
}

function deriveMetrics(item: any): Record<string, any> | null {
  const metricsObj = item?.metrics;
  if (metricsObj && typeof metricsObj === 'object' && !Array.isArray(metricsObj)) {
    return metricsObj as Record<string, any>;
  }

  const metrics: Record<string, any> = {};
  const ctr = firstNumber(item?.ctr);
  const cost = firstNumber(item?.cost, item?.spend, item?.spent);
  const likes = firstNumber(item?.like, item?.likes);
  const impressions = firstNumber(item?.impressions);
  const clicks = firstNumber(item?.clicks);
  const conversions = firstNumber(item?.conversions, item?.purchases);
  const duration = firstNumber(item?.video_info?.duration, item?.duration);

  if (ctr !== null) metrics.ctr = ctr;
  if (cost !== null) metrics.cost = cost;
  if (likes !== null) metrics.likes = likes;
  if (impressions !== null) metrics.impressions = impressions;
  if (clicks !== null) metrics.clicks = clicks;
  if (conversions !== null) metrics.conversions = conversions;
  if (duration !== null) metrics.duration = duration;

  return Object.keys(metrics).length > 0 ? metrics : null;
}

function normalizeApifyItemForJob(item: any): JobNormalizedAd {
  const raw = asRawObject(item);

  const adId = firstString(raw?.adId, raw?.ad_id, raw?.id, raw?.itemId, raw?.item_id);
  const platform = firstString(raw?.platform, raw?.source, raw?.network);
  const pageName = firstString(raw?.pageName, raw?.page_name, raw?.page, raw?.accountName, raw?.account_name);
  const brand = firstString(raw?.brand, raw?.advertiser, raw?.advertiserName, raw?.advertiser_name, pageName);
  const createdAt = parseDateToIso(raw?.createdAt ?? raw?.created_at ?? raw?.date ?? raw?.timestamp);
  const text = firstString(raw?.text, raw?.caption, raw?.description, raw?.adText, raw?.ad_text, raw?.ocr_text, raw?.transcript);

  const videoUrlObj = raw?.video_info?.video_url;
  const mediaUrl =
    firstString(raw?.mediaUrl, raw?.media_url, raw?.videoUrl, raw?.video_url, raw?.imageUrl, raw?.image_url) ??
    (typeof videoUrlObj === 'string'
      ? firstString(videoUrlObj)
      : firstString(videoUrlObj?.['720p'], videoUrlObj?.['1080p']) ??
        (videoUrlObj && typeof videoUrlObj === 'object' ? firstString(...Object.values(videoUrlObj)) : null));

  const landingUrl = firstString(
    raw?.landingUrl,
    raw?.landing_url,
    raw?.destinationUrl,
    raw?.destination_url,
    raw?.clickUrl,
    raw?.click_url,
    raw?.url,
  );

  return {
    source: 'apify',
    adId,
    platform,
    pageName,
    brand,
    createdAt,
    text,
    mediaUrl,
    landingUrl,
    metrics: deriveMetrics(raw),
    raw,
  };
}

/**
 * Validate ads have required fields and extract retention_3s / retention_10s.
 */
function validateAndNormalizeAds(rawAds: ApifyAd[]): NormalizedAd[] {
  const validated: NormalizedAd[] = [];

  for (const ad of rawAds) {
    const videoUrl720 = ad.video_info?.video_url?.['720p'];
    const duration = ad.video_info?.duration;

    const playArr =
      ad.keyframe_metrics?.play_retain_cnt?.analysis ?? undefined;
    const convertArr =
      ad.keyframe_metrics?.convert_cnt?.analysis ?? undefined;

    if (!ad.id || !videoUrl720 || !duration || !playArr) {
      continue;
    }

    const retention3s = extractRetention(playArr, 3);
    const retention10s = extractRetention(playArr, 10);

    validated.push({
      id: ad.id,
      videoUrl: videoUrl720,
      retention3s,
      retention10s,
      duration,
      ctr: ad.ctr ?? null,
      cost: ad.cost ?? null,
      like: ad.like ?? null,
      adTitle: ad.ad_title ?? null,
      playRetainCnt: playArr,
      convertCnt: convertArr ?? [],
      conversionSpikes: ad.keyframe_metrics?.convert_cnt?.highlight ?? null,
    });
  }

  return validated;
}

/**
 * Apply quality filters from the workflow:
 * - retention_3s >= 0.08
 * - 10s <= duration <= 90s
 * Then sort by retention_3s desc.
 */
function filterAdDataQuality(validated: NormalizedAd[]): NormalizedAd[] {
  const filtered = validated.filter(ad => {
    if (ad.retention3s < 0.08) return false;
    if (ad.duration < 10 || ad.duration > 90) return false;
    return true;
  });

  filtered.sort(
    (a, b) => (b.retention3s || 0) - (a.retention3s || 0),
  );

  return filtered;
}

/**
 * Save normalized ads into AdAsset with metrics JSON aligned to what
 * the Pattern Brain needs later.
 */
async function saveAdsToPrisma(options: {
  projectId: string;
  jobId: string;
  industryCode: string;
  ads: NormalizedAd[];
}) {
  const { projectId, jobId, industryCode, ads } = options;

  if (!ads.length) return;

  const data = ads.map(ad => ({
    projectId,
    jobId,
    platform: AdPlatform.TIKTOK,
    rawJson: {
      url: ad.videoUrl,
      metrics: {
        source: 'apify',
        source_type: 'paid',
        industry_code: industryCode,
        retention_3s: ad.retention3s,
        retention_10s: ad.retention10s,
        duration: ad.duration,
        ctr: ad.ctr,
        cost: ad.cost,
        like: ad.like,
        ad_title: ad.adTitle,
        play_retain_cnt: ad.playRetainCnt,
        convert_cnt: ad.convertCnt,
        conversion_spikes: ad.conversionSpikes,
      },
    } as any,
  }));

  await prisma.adAsset.createMany({ data });
}

/**
 * Main orchestrator for Phase 2A – Ad Raw Collection.
 * This corresponds to: Data Structuring → Apify dataset → Validate → Filter → Sort → Save Ads.
 */
export async function runAdRawCollection(args: {
  projectId: string;
  industryCode: string;
  jobId: string;
}) {
  const { projectId, industryCode, jobId } = args;

  // 1) Fetch from Apify
  const apify = await fetchApifyAds({ projectId, industryCode });
  const rawAds = apify.items;
  const normalizedAds = rawAds.map(normalizeApifyItemForJob);

  // 2) Validate + add retention metrics
  const validated = validateAndNormalizeAds(rawAds);

  // 3) Filter and sort quality ads
  const filtered = filterAdDataQuality(validated);

  // 4) Persist to Prisma
  await saveAdsToPrisma({
    projectId,
    jobId,
    industryCode,
    ads: filtered,
  });

  return {
    apify: {
      actorId: apify.actorId,
      runId: apify.runId,
      datasetId: apify.datasetId,
      itemCount: rawAds.length,
    },
    ads: normalizedAds,
    totalValidated: validated.length,
    totalSaved: filtered.length,
  };
}

/**
 * Convenience wrapper that creates a Job record and runs the pipeline,
 * updating Job.status and Job.resultSummary.
 */
export async function startAdRawCollectionJob(params: {
  projectId: string;
  industryCode: string;
  jobId: string;
}) {
  const { projectId, industryCode, jobId } = params;
  await updateJobStatus(jobId, JobStatus.RUNNING);
  try {
    const result = await runAdRawCollection({
      projectId,
      industryCode,
      jobId,
    });

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { payload: true },
    });
    const payload = asPlainObject(existing?.payload);

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: Prisma.JsonNull,
        payload: {
          ...payload,
          result: {
            ok: true,
            apify: result.apify,
            ads: result.ads,
          },
        },
        resultSummary: `Ads: ${result.apify.itemCount}`,
      },
    });

    return { jobId, ...result.apify, totalSaved: result.totalSaved, totalValidated: result.totalValidated };
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err?.message ?? 'Unknown error in Phase 2A',
      },
    });

    throw err;
  }
}
