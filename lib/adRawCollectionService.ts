// lib/adRawCollectionService.ts
import prisma from '@/lib/prisma';
import { AdPlatform, JobStatus, Prisma } from '@prisma/client';
import { ConfigError, env, requireEnv } from './configGuard.ts';
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
    retain_ctr?: {
      analysis?: { second: number; value: number }[];
      highlight?: any;
    };
    retain_cvr?: {
      analysis?: { second: number; value: number }[];
      highlight?: any;
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
  retention3sCtr: number;
  retention10sCtr: number;
  retention3sCvr: number;
  retention10sCvr: number;
  duration: number;
  ctr: number | null;
  cost: number | null;
  like: number | null;
  adTitle: string | null;
  playRetainCnt: any;
  retainCtr: any;
  retainCvr: any;
  convertCnt: any;
  conversionSpikes: any;
  sourceType: string;
  engagementScore: number;
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

export type AdCollectionConfig = {
  ad_language: string[];
  country: string[];
  include_analytics: boolean;
  include_keyframe_metrics: string[];
  industry: string[];
  likes: string[];
  limit: number;
  period: string;
  sort_by: string;
  top_ads_spotlight: boolean;
};

export function buildAdCollectionConfig(industryCode: string): AdCollectionConfig {
  return {
    ad_language: ["en"],
    country: ["US"],
    include_analytics: true,
    include_keyframe_metrics: ["retain_cvr", "retain_ctr", "play_retain_cnt"],
    industry: [industryCode],
    likes: ["1-20"],
    limit: 10,
    period: "30",
    sort_by: "cvr",
    top_ads_spotlight: false,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getAdResearchApifyToken(): string {
  // Temporary debug signal for env wiring issues.
  console.log('[adRawCollectionService] APIFY_TOKEN:', env('APIFY_TOKEN') ? 'Present' : 'Missing');
  console.log('[adRawCollectionService] APIFY_API_TOKEN_AUX:', env('APIFY_API_TOKEN_AUX') ? 'Present' : 'Missing');
  console.log('[adRawCollectionService] APIFY_API_TOKEN:', env('APIFY_API_TOKEN') ? 'Present' : 'Missing');

  // Ad research route uses AUX token when provided, otherwise falls back to MAIN.
  const aux = env('APIFY_API_TOKEN_AUX');
  if (aux) return aux;

  const main = env('APIFY_API_TOKEN');
  if (main) return main;

  const legacy = env('APIFY_TOKEN');
  if (legacy) return legacy;

  throw new ConfigError('APIFY: APIFY_API_TOKEN_AUX or APIFY_API_TOKEN or APIFY_TOKEN must be set in .env');
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

function unwrapApifyItem(item: unknown): Record<string, any> {
  const raw = asRawObject(item);
  if (raw?.json && typeof raw.json === 'object' && !Array.isArray(raw.json)) {
    return raw.json as Record<string, any>;
  }
  return raw;
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
  const token = getAdResearchApifyToken();

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
  const token = getAdResearchApifyToken();

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
  requireEnv(['APIFY_TIKTOK_ACTOR_ID'], 'APIFY');
  const token = getAdResearchApifyToken();
  const actorId = env('APIFY_TIKTOK_ACTOR_ID')!;

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

function extractMetricAtSecond(
  analysis: Array<{ second?: number; value?: number } | Record<string, any>> | undefined,
  second: number,
): number {
  if (!Array.isArray(analysis)) return 0;
  const hit = analysis.find((row: any) => firstNumber(row?.second, row?.t) === second);
  const value = firstNumber(hit?.value);
  return value ?? 0;
}

/**
 * Fetch raw ads from Apify dataset.
 * The n8n workflow builds an input payload for an Apify actor, but here
 * we simplify: we fetch items from a dataset ID and then filter/normalize in code.
 */
async function fetchApifyAds(options: {
  config: AdCollectionConfig;
}): Promise<{ items: ApifyAd[]; actorId: string | null; runId: string | null; datasetId: string }> {
  requireEnv(['APIFY_TIKTOK_ACTOR_ID'], 'APIFY');

  const actorId = env('APIFY_TIKTOK_ACTOR_ID')!;
  const { runId, datasetId } = await runApifyActor(options.config);
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
  const raw = unwrapApifyItem(item);

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

function validateApifyData(items: any[]): NormalizedAd[] {
  if (!items?.length) throw new Error('Apify returned no data');

  const validated = items
    .map((item) => unwrapApifyItem(item))
    .filter((j) => {
      const videoUrl =
        firstString(j?.video_info?.video_url?.['720p']) ??
        firstString(j?.video_info?.video_url?.['1080p']) ??
        (typeof j?.video_info?.video_url === 'string' ? firstString(j?.video_info?.video_url) : null) ??
        firstString(j?.url, j?.videoUrl);
      const duration = firstNumber(j?.video_info?.duration, j?.duration);
      const playRetainAnalysis = j?.keyframe_metrics?.play_retain_cnt?.analysis;
      return Boolean(j?.id && videoUrl && duration !== null && Array.isArray(playRetainAnalysis));
    });

  if (!validated.length) throw new Error('All results missing required fields');

  return validated.map((j) => {
    const videoUrl =
      firstString(j?.video_info?.video_url?.['720p']) ??
      firstString(j?.video_info?.video_url?.['1080p']) ??
      (typeof j?.video_info?.video_url === 'string' ? firstString(j?.video_info?.video_url) : null) ??
      firstString(j?.url, j?.videoUrl) ??
      '';
    const duration = Math.round(firstNumber(j?.video_info?.duration, j?.duration) ?? 0);
    const metrics = asPlainObject(j?.keyframe_metrics);
    const playRetainAnalysis = Array.isArray(metrics?.play_retain_cnt?.analysis)
      ? metrics.play_retain_cnt.analysis
      : [];
    const retainCtrAnalysis = Array.isArray(metrics?.retain_ctr?.analysis)
      ? metrics.retain_ctr.analysis
      : [];
    const retainCvrAnalysis = Array.isArray(metrics?.retain_cvr?.analysis)
      ? metrics.retain_cvr.analysis
      : [];
    const convertCntAnalysis = Array.isArray(metrics?.convert_cnt?.analysis)
      ? metrics.convert_cnt.analysis
      : [];
    const conversionSpikes =
      metrics?.convert_cnt?.highlight ??
      metrics?.retain_cvr?.highlight ??
      metrics?.retain_ctr?.highlight ??
      null;

    return {
      id: String(j.id),
      videoUrl,
      retention3s: extractMetricAtSecond(playRetainAnalysis, 3),
      retention10s: extractMetricAtSecond(playRetainAnalysis, 10),
      retention3sCtr: extractMetricAtSecond(retainCtrAnalysis, 3),
      retention10sCtr: extractMetricAtSecond(retainCtrAnalysis, 10),
      retention3sCvr: extractMetricAtSecond(retainCvrAnalysis, 3),
      retention10sCvr: extractMetricAtSecond(retainCvrAnalysis, 10),
      duration,
      ctr: firstNumber(j?.ctr),
      cost: firstNumber(j?.cost, j?.spend),
      like: firstNumber(j?.like, j?.likes),
      adTitle: firstString(j?.ad_title, j?.title),
      playRetainCnt: playRetainAnalysis,
      retainCtr: retainCtrAnalysis,
      retainCvr: retainCvrAnalysis,
      convertCnt: convertCntAnalysis,
      conversionSpikes,
      sourceType: 'paid',
      engagementScore: 0,
    };
  });
}

function calculateEngagementScore(ad: NormalizedAd): number {
  const retention = ad.retention3s || 0;
  const ctr = ad.retention3sCtr || 0;
  const cvr = ad.retention3sCvr || 0;
  return (retention * 0.5) + (ctr * 0.3) + (cvr * 0.2);
}

function filterQualityThresholds(ads: NormalizedAd[]): NormalizedAd[] {
  return ads
    .filter((ad) => {
      if (ad.retention3s < 0.08) return false;
      if (ad.duration < 10 || ad.duration > 90) return false;
      if (ad.retention3sCtr < 0.01) return false;
      return true;
    })
    .map((ad) => ({
      ...ad,
      engagementScore: calculateEngagementScore(ad),
    }));
}

function sortByEngagement(ads: NormalizedAd[]): NormalizedAd[] {
  return ads
    .filter((ad) => Number.isFinite(ad.engagementScore))
    .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
    .map((ad) => ({
      ...ad,
      sourceType: 'paid',
    }));
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

  if (!ads.length) {
    console.log("[adRawCollection] About to insert 0 ad assets");
    console.log("[adRawCollection] Inserted 0 ad assets");
    return;
  }

  const data = ads.map(ad => ({
    projectId,
    jobId,
    platform: AdPlatform.TIKTOK,
    retention_3s: ad.retention3s,
    retention_10s: ad.retention10s,
    retention_3s_ctr: ad.retention3sCtr,
    retention_10s_ctr: ad.retention10sCtr,
    retention_3s_cvr: ad.retention3sCvr,
    retention_10s_cvr: ad.retention10sCvr,
    duration: ad.duration,
    source_type: ad.sourceType,
    engagement_score: ad.engagementScore,
    rawJson: {
      url: ad.videoUrl,
      metrics: {
        source: 'apify',
        source_type: ad.sourceType,
        industry_code: industryCode,
        retention_3s: ad.retention3s,
        retention_10s: ad.retention10s,
        retention_3s_ctr: ad.retention3sCtr,
        retention_10s_ctr: ad.retention10sCtr,
        retention_3s_cvr: ad.retention3sCvr,
        retention_10s_cvr: ad.retention10sCvr,
        duration: ad.duration,
        engagement_score: ad.engagementScore,
        ctr: ad.ctr,
        cost: ad.cost,
        like: ad.like,
        ad_title: ad.adTitle,
        play_retain_cnt: ad.playRetainCnt,
        retain_ctr: ad.retainCtr,
        retain_cvr: ad.retainCvr,
        convert_cnt: ad.convertCnt,
        conversion_spikes: ad.conversionSpikes,
      },
    } as any,
  }));

  console.log("[adRawCollection] About to insert", data.length, "ad assets");
  const result = await prisma.adAsset.createMany({ data });
  console.log("[adRawCollection] Inserted", result.count, "ad assets");
}

/**
 * Main orchestrator for Phase 2A – Ad Raw Collection.
 * This corresponds to: Data Structuring → Apify dataset → Validate → Filter → Sort → Save Ads.
 */
export async function runAdRawCollection(args: {
  projectId: string;
  industryCode: string;
  runId?: string | null;
  jobId: string;
  config?: AdCollectionConfig;
}) {
  const { projectId, industryCode, runId, jobId, config } = args;
  const effectiveRunId = String(runId ?? "").trim();
  const effectiveConfig = config ?? buildAdCollectionConfig(industryCode);

  // 1) Fetch from Apify
  const apify = await fetchApifyAds({ config: effectiveConfig });
  const rawAds = apify.items;
  const normalizedAds = rawAds.map(normalizeApifyItemForJob);
  const effectiveIndustryCode = firstString(effectiveConfig.industry?.[0], industryCode) ?? industryCode;
  console.log("[adRawCollection] Apify returned", rawAds.length, "items");

  // 2) Validate + add retention/keyframe metrics
  const validated = validateApifyData(rawAds);
  console.log("[adRawCollection] Validated", validated.length, "items");

  // 3) Filter quality thresholds and score engagement
  const filtered = filterQualityThresholds(validated);
  console.log("[adRawCollection] Quality-filtered", filtered.length, "items");

  // 4) Sort by engagement
  const sorted = sortByEngagement(filtered);
  console.log("[adRawCollection] Engagement-sorted", sorted.length, "items");

  // 5) Persist to Prisma
  await saveAdsToPrisma({
    projectId,
    jobId,
    industryCode: effectiveIndustryCode,
    ads: sorted,
  });

  return {
    runId: effectiveRunId || null,
    apify: {
      actorId: apify.actorId,
      runId: apify.runId,
      datasetId: apify.datasetId,
      itemCount: rawAds.length,
    },
    ads: normalizedAds,
    totalValidated: validated.length,
    totalSaved: sorted.length,
  };
}

export async function collectAds(
  projectId: string,
  runId: string,
  jobId: string,
  config: AdCollectionConfig,
) {
  const industryCode = firstString(config?.industry?.[0]) ?? "unknown";
  return runAdRawCollection({
    projectId,
    runId,
    jobId,
    industryCode,
    config,
  });
}

/**
 * Convenience wrapper that creates a Job record and runs the pipeline,
 * updating Job.status and Job.resultSummary.
 */
export async function startAdRawCollectionJob(params: {
  projectId: string;
  industryCode: string;
  runId?: string | null;
  jobId: string;
  config?: AdCollectionConfig;
}) {
  const { projectId, industryCode, runId, jobId, config } = params;
  await updateJobStatus(jobId, JobStatus.RUNNING);
  try {
    const result = await runAdRawCollection({
      projectId,
      industryCode,
      runId,
      jobId,
      config,
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
