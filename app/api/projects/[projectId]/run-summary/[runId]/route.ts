import { NextRequest, NextResponse } from "next/server";
import { AdPlatform, JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export const runtime = "nodejs";

type ProductRow = {
  name: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

type SwipeCandidate = {
  assetId: string;
  title: string | null;
  score: number;
  reasons: string[];
  metrics: {
    views: number | null;
    engagementScore: number | null;
    retention3s: number | null;
    retention10s: number | null;
    ctr: number | null;
  };
  sourceUrl: string | null;
  transcriptSnippet: string | null;
  ocrText: string | null;
  selectionSource: "swipe_file" | "run_ad";
  createdAt: string | null;
};

function truncateText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function scoreSwipeCandidate(rawJson: Record<string, unknown>): {
  score: number;
  reasons: string[];
  metrics: SwipeCandidate["metrics"];
} {
  const metricsRoot = asObject(rawJson.metrics) ?? {};
  const views = asNumber(metricsRoot.views ?? metricsRoot.view ?? metricsRoot.plays);
  const engagementScore = asNumber(metricsRoot.engagement_score);
  const retention3s = asNumber(metricsRoot.retention_3s);
  const retention10s = asNumber(metricsRoot.retention_10s);
  const ctr = asNumber(metricsRoot.ctr);

  const viewsNorm = views && views > 0 ? Math.min(1, Math.log10(views + 1) / 7) : 0;
  const engagementNorm = engagementScore !== null ? Math.max(0, Math.min(1, engagementScore)) : 0;
  const r3Norm = retention3s !== null ? Math.max(0, Math.min(1, retention3s)) : 0;
  const r10Norm = retention10s !== null ? Math.max(0, Math.min(1, retention10s)) : 0;
  const ctrNorm = ctr !== null ? Math.max(0, Math.min(1, ctr)) : 0;

  const score =
    0.35 * engagementNorm +
    0.25 * r3Norm +
    0.2 * r10Norm +
    0.1 * ctrNorm +
    0.1 * viewsNorm;

  const reasons: string[] = [];
  if (engagementScore !== null) reasons.push(`engagement ${engagementScore.toFixed(3)}`);
  if (retention3s !== null) reasons.push(`3s retain ${(retention3s * 100).toFixed(1)}%`);
  if (retention10s !== null) reasons.push(`10s retain ${(retention10s * 100).toFixed(1)}%`);
  if (ctr !== null) reasons.push(`CTR ${(ctr * 100).toFixed(2)}%`);
  if (views !== null) reasons.push(`${Math.round(views).toLocaleString()} views`);

  return {
    score: Number(score.toFixed(4)),
    reasons: reasons.slice(0, 4),
    metrics: {
      views,
      engagementScore,
      retention3s,
      retention10s,
      ctr,
    },
  };
}

function extractAvatarSummary(resultSummary: unknown): string | null {
  const summaryContainer = asObject(resultSummary);
  if (!summaryContainer) return null;

  const summary = summaryContainer.summary;
  const summaryText = asString(summary);
  if (summaryText) return summaryText;

  const summaryObject = asObject(summary);
  const avatar = asObject(summaryObject?.avatar);
  const primaryPain = asString(avatar?.primaryPain);
  const primaryGoal = asString(avatar?.primaryGoal);

  const parts = [
    primaryPain ? `Pain: ${primaryPain}` : null,
    primaryGoal ? `Goal: ${primaryGoal}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(" | ") : null;
}

function extractTransferFormula(rawPatternJson: unknown): string | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);

  return (
    asString(prescriptiveGuidance?.transferFormula) ||
    asString(prescriptiveGuidance?.transfer_formula) ||
    null
  );
}

function extractPsychologicalMechanism(rawPatternJson: unknown): string | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);

  return (
    asString(prescriptiveGuidance?.psychologicalMechanism) ||
    asString(prescriptiveGuidance?.psychological_mechanism) ||
    null
  );
}

function extractProductNameFromPayload(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;

  const direct =
    asString(root.productName) ||
    asString(root.product_name) ||
    asString(root.productTitle) ||
    null;
  if (direct) return direct;

  const result = asObject(root.result);
  const intel = asObject(result?.intel);
  return (
    asString(intel?.productName) ||
    asString(intel?.product_name) ||
    null
  );
}

async function lookupProductName(projectId: string, payload: unknown): Promise<string | null> {
  const root = asObject(payload);
  const productId = asString(root?.productId);
  if (!productId) return null;

  try {
    const rows = await prisma.$queryRaw<ProductRow[]>`
      SELECT "name"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "id" = ${productId}
      LIMIT 1
    `;
    return asString(rows[0]?.name);
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string; runId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const projectId = String(params?.projectId || "").trim();
    const runId = String(params?.runId || "").trim();
    if (!projectId || !runId) {
      return NextResponse.json({ error: "projectId and runId are required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId,
      },
      select: {
        id: true,
        name: true,
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true },
    });
    if (!run || run.projectId !== projectId) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const [customerAnalysisJob, patternAnalysisJob, productCollectionJob] = await Promise.all([
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.CUSTOMER_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          resultSummary: true,
        },
      }),
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          resultSummary: true,
        },
      }),
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.PRODUCT_DATA_COLLECTION,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          payload: true,
        },
      }),
    ]);

    const swipeAssets = await prisma.adAsset.findMany({
      where: {
        projectId,
        isSwipeFile: true,
        swipeMetadata: { not: null },
        job: {
          is: {
            runId,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        createdAt: true,
        rawJson: true,
      },
    });

    const fallbackRunAds =
      swipeAssets.length > 0
        ? []
        : await prisma.adAsset.findMany({
            where: {
              projectId,
              platform: AdPlatform.TIKTOK,
              job: {
                is: {
                  runId,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 60,
            select: {
              id: true,
              createdAt: true,
              rawJson: true,
            },
          });

    const scoredAssets = swipeAssets.length > 0 ? swipeAssets : fallbackRunAds;
    const selectionSource: "swipe_file" | "run_ad" =
      swipeAssets.length > 0 ? "swipe_file" : "run_ad";

    const swipeCandidates: SwipeCandidate[] = scoredAssets
      .map((asset) => {
        const raw = asObject(asset.rawJson) ?? {};
        const title =
          asString(raw.ad_title) ||
          asString(raw.title) ||
          asString(raw.headline) ||
          null;
        const sourceUrl =
          asString(raw.url) ||
          asString(raw.videoUrl) ||
          asString(raw.video_url) ||
          asString(raw.sourceUrl) ||
          null;
        const transcriptSnippet = truncateText(
          asString(raw.transcriptText) ||
            asString(raw.transcript) ||
            asString(raw.transcript_text) ||
            asString(raw.whisperTranscript) ||
            asString(raw.assemblyTranscript) ||
            null,
          420,
        );
        const ocrText = truncateText(
          asString(raw.ocrText) ||
            asString(raw.ocr_text) ||
            null,
          220,
        );
        const scored = scoreSwipeCandidate(raw);
        return {
          assetId: asset.id,
          title,
          score: scored.score,
          reasons: scored.reasons,
          metrics: scored.metrics,
          sourceUrl,
          transcriptSnippet,
          ocrText,
          selectionSource,
          createdAt: toIsoString(asset.createdAt),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const recommendedSwipe = swipeCandidates[0] ?? null;
    const patternResult = patternAnalysisJob
      ? await prisma.adPatternResult.findFirst({
          where: {
            projectId,
            jobId: patternAnalysisJob.id,
          },
          orderBy: { createdAt: "desc" },
          select: {
            summary: true,
            rawJson: true,
          },
        })
      : null;
    const transferFormula = extractTransferFormula(patternResult?.rawJson);
    const psychologicalMechanism = extractPsychologicalMechanism(patternResult?.rawJson);

    const avatarSummary = extractAvatarSummary(customerAnalysisJob?.resultSummary);
    let productName = extractProductNameFromPayload(productCollectionJob?.payload);
    if (!productName && productCollectionJob) {
      productName = await lookupProductName(projectId, productCollectionJob.payload);
    }
    if (!productName) {
      productName = project.name;
    }

    return NextResponse.json(
      {
        success: true,
        runId,
        customerAnalysis: {
          present: Boolean(customerAnalysisJob),
          jobId: customerAnalysisJob?.id ?? null,
          completedAt: toIsoString(customerAnalysisJob?.updatedAt),
          avatarSummary: avatarSummary ?? null,
        },
        patternAnalysis: {
          present: Boolean(patternAnalysisJob),
          jobId: patternAnalysisJob?.id ?? null,
          completedAt: toIsoString(patternAnalysisJob?.updatedAt),
          formulaSummary: transferFormula ?? null,
          psychologicalMechanism: psychologicalMechanism ?? null,
          summary:
            asString(patternResult?.summary) ||
            asString(asObject(patternAnalysisJob?.resultSummary)?.summary) ||
            null,
        },
        productCollection: {
          present: Boolean(productCollectionJob),
          jobId: productCollectionJob?.id ?? null,
          completedAt: toIsoString(productCollectionJob?.updatedAt),
          productName: productCollectionJob ? productName : null,
        },
        swipeRecommendation: {
          present: swipeCandidates.length > 0,
          recommendedAdId: recommendedSwipe?.assetId ?? null,
          sourceMode: selectionSource,
          candidates: swipeCandidates,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to fetch run summary" },
      { status: 500 },
    );
  }
}
