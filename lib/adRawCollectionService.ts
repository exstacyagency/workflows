// lib/adRawCollectionService.ts
import prisma from '@/lib/prisma';
import { AdPlatform, JobStatus, JobType } from '@prisma/client';

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
async function fetchApifyAds(industryCode: string): Promise<ApifyAd[]> {
  const token = process.env.APIFY_API_TOKEN;
  const datasetId = process.env.APIFY_DATASET_ID;

  if (!token || !datasetId) {
    throw new Error('APIFY_API_TOKEN and APIFY_DATASET_ID must be set in .env');
  }

  const url = new URL(
    `https://api.apify.com/v2/datasets/${datasetId}/items`,
  );
  url.searchParams.set('token', token);
  url.searchParams.set('clean', 'true');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), {
    method: 'GET',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify dataset request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as ApifyAd[];

  // Optional: if your dataset includes multiple industries, you could filter by
  // a field like ad.industry_code === industryCode. Adjust if needed.
  // For now, we just return all items; your Apify actor should already filter.
  return data;
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

  if (!validated.length) {
    throw new Error('Apify returned no valid ads with required fields');
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
  const rawAds = await fetchApifyAds(industryCode);

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
    totalRaw: rawAds.length,
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
}) {
  const { projectId, industryCode } = params;

  const job = await prisma.job.create({
    data: {
      type: JobType.AD_PERFORMANCE,
      status: JobStatus.RUNNING,
      projectId,
      payload: { projectId, industryCode },
    },
  });

  try {
    const result = await runAdRawCollection({
      projectId,
      industryCode,
      jobId: job.id,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Phase 2A: saved ${result.totalSaved}/${result.totalValidated} ads (raw=${result.totalRaw})`,
      },
    });

    return { jobId: job.id, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error in Phase 2A',
      },
    });

    throw err;
  }
}
