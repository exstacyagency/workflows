import { NextRequest, NextResponse } from "next/server";
import { AdPlatform, JobStatus, JobType, Prisma } from "@prisma/client";
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

type FormulaComponent = {
  name: string;
  executionBrief: string;
};

type TransferFormulaDetails = {
  label: string | null;
  components: FormulaComponent[];
};

type PsychologicalMechanismDetails = {
  label: string | null;
  executionBrief: string | null;
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

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function hasPassedQualityAssessment(rawJson: unknown): boolean {
  const raw = asObject(rawJson);
  if (!raw) return false;
  const qualityGate = asObject(raw.qualityGate);
  const qualityGateViable = asBoolean(qualityGate?.viable);
  if (qualityGateViable === true) return true;
  const contentViable = asBoolean(raw.contentViable);
  return contentViable === true;
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

function extractTransferFormulaDetails(rawPatternJson: unknown): TransferFormulaDetails | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);
  const rawFormula = prescriptiveGuidance?.transferFormula ?? prescriptiveGuidance?.transfer_formula;
  const formulaObj = asObject(rawFormula);
  if (!formulaObj) return null;

  const label = asString(formulaObj.label);
  const componentsRaw = Array.isArray(formulaObj.components) ? formulaObj.components : [];
  const components = componentsRaw
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      name: asString(entry.name) ?? "",
      executionBrief: asString(entry.executionBrief) ?? asString(entry.execution_brief) ?? "",
    }))
    .filter((entry) => entry.name || entry.executionBrief);

  if (!label && components.length === 0) return null;
  return { label, components };
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

function extractPsychologicalMechanismDetails(
  rawPatternJson: unknown,
): PsychologicalMechanismDetails | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);
  const rawMechanism =
    prescriptiveGuidance?.psychologicalMechanism ||
    prescriptiveGuidance?.psychological_mechanism;
  const mechanismObj = asObject(rawMechanism);
  if (!mechanismObj) return null;
  const label = asString(mechanismObj.label);
  const executionBrief =
    asString(mechanismObj.executionBrief) || asString(mechanismObj.execution_brief);
  if (!label && !executionBrief) return null;
  return { label, executionBrief };
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

    type CandidateAdRow = {
      id: string;
      createdAt: Date;
      rawJson: Prisma.JsonValue;
    };

    const projectedRawJson = Prisma.sql`
      jsonb_strip_nulls(
        jsonb_build_object(
          'contentViable', a."rawJson"->'contentViable',
          'qualityGate',
            jsonb_strip_nulls(
              jsonb_build_object(
                'viable', a."rawJson"->'qualityGate'->'viable',
                'confidence', a."rawJson"->'qualityGate'->'confidence'
              )
            ),
          'ad_title', a."rawJson"->>'ad_title',
          'title', a."rawJson"->>'title',
          'headline', a."rawJson"->>'headline',
          'url', a."rawJson"->>'url',
          'videoUrl', COALESCE(a."rawJson"->>'videoUrl', a."rawJson"->>'video_url'),
          'sourceUrl', a."rawJson"->>'sourceUrl',
          'transcriptText', a."rawJson"->>'transcriptText',
          'transcript', a."rawJson"->>'transcript',
          'transcript_text', a."rawJson"->>'transcript_text',
          'whisperTranscript', a."rawJson"->>'whisperTranscript',
          'assemblyTranscript', a."rawJson"->>'assemblyTranscript',
          'ocrText', a."rawJson"->>'ocrText',
          'ocr_text', a."rawJson"->>'ocr_text',
          'metrics',
            jsonb_strip_nulls(
              jsonb_build_object(
                'views', a."rawJson"->'metrics'->'views',
                'view', a."rawJson"->'metrics'->'view',
                'plays', a."rawJson"->'metrics'->'plays',
                'engagement_score', a."rawJson"->'metrics'->'engagement_score',
                'retention_3s', a."rawJson"->'metrics'->'retention_3s',
                'retention_10s', a."rawJson"->'metrics'->'retention_10s',
                'ctr', a."rawJson"->'metrics'->'ctr'
              )
            )
        )
      )
    `;

    const swipeAssets = await prisma.$queryRaw<CandidateAdRow[]>(
      Prisma.sql`
        SELECT
          a."id",
          a."createdAt",
          ${projectedRawJson} AS "rawJson"
        FROM "ad_asset" a
        LEFT JOIN "job" j ON j."id" = a."jobId"
        WHERE a."projectId" = ${projectId}
          AND COALESCE(a."isSwipeFile", false) = true
          AND a."swipeMetadata" IS NOT NULL
          AND j."runId" = ${runId}
        ORDER BY a."createdAt" DESC
        LIMIT 60
      `,
    );

    const fallbackRunAds =
      swipeAssets.length > 0
        ? []
        : await prisma.$queryRaw<CandidateAdRow[]>(
            Prisma.sql`
              SELECT
                a."id",
                a."createdAt",
                ${projectedRawJson} AS "rawJson"
              FROM "ad_asset" a
              LEFT JOIN "job" j ON j."id" = a."jobId"
              WHERE a."projectId" = ${projectId}
                AND a."platform" = CAST(${AdPlatform.TIKTOK} AS "AdPlatform")
                AND j."runId" = ${runId}
                AND (a."rawJson"->>'transcript') IS NOT NULL
                AND LENGTH(TRIM(a."rawJson"->>'transcript')) > 50
              ORDER BY a."createdAt" DESC
              LIMIT 60
            `
          );

    const passedSwipeAssets = swipeAssets.filter((asset) => hasPassedQualityAssessment(asset.rawJson));
    const passedFallbackRunAds = fallbackRunAds.filter((asset) => hasPassedQualityAssessment(asset.rawJson));

    const scoredAssets = passedSwipeAssets.length > 0 ? passedSwipeAssets : passedFallbackRunAds;
    const selectionSource: "swipe_file" | "run_ad" =
      passedSwipeAssets.length > 0 ? "swipe_file" : "run_ad";

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
    const transferFormulaDetails = extractTransferFormulaDetails(patternResult?.rawJson);
    const psychologicalMechanismDetails =
      extractPsychologicalMechanismDetails(patternResult?.rawJson);

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
          formulaDetails: transferFormulaDetails ?? null,
          psychologicalMechanism: psychologicalMechanism ?? null,
          psychologicalMechanismDetails: psychologicalMechanismDetails ?? null,
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
