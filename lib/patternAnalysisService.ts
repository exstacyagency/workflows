import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({
  apiKey: cfg.raw("ANTHROPIC_API_KEY"),
});

const QUALITY_CONFIDENCE_THRESHOLD = 70;
const MAX_ADS_FOR_ANALYSIS = 80;

type AdCompletenessArgs = {
  projectId: string;
  runId?: string | null;
};

type AdCompleteness = {
  totalAds: number;
  withTranscript: number;
  withOcr: number;
  withKeyframe: number;
  withAllData: number;
  transcriptCoverage: number;
  ocrCoverage: number;
  keyframeCoverage: number;
  assessedAds: number;
  viableAds: number;
  rejectedAds: number;
  confidenceThreshold: number;
  canRun: boolean;
  reason: string | null;
};

type AdForAnalysis = {
  id: string;
  rawJson: Record<string, any>;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = asNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function hasTranscript(raw: Record<string, any>): boolean {
  return Boolean(asString(raw?.transcript));
}

function hasOcr(raw: Record<string, any>): boolean {
  if (asString(raw?.ocrText)) return true;
  if (!Array.isArray(raw?.ocrFrames)) return false;
  return raw.ocrFrames.some((frame: any) => Boolean(asString(frame?.text)));
}

function getKeyframeMetrics(raw: Record<string, any>) {
  const top = isPlainObject(raw?.keyframe_metrics) ? raw.keyframe_metrics : {};
  const metrics = isPlainObject(raw?.metrics) ? raw.metrics : {};
  return {
    playRetain: top?.play_retain_cnt ?? metrics?.play_retain_cnt ?? null,
    convertCnt: top?.convert_cnt ?? metrics?.convert_cnt ?? null,
    clickCnt: top?.click_cnt ?? metrics?.click_cnt ?? null,
  };
}

function hasKeyframe(raw: Record<string, any>): boolean {
  const { playRetain, convertCnt, clickCnt } = getKeyframeMetrics(raw);
  const playAnalysis = Array.isArray(playRetain?.analysis) ? playRetain.analysis : [];
  const convertHighlights = Array.isArray(convertCnt?.highlight) ? convertCnt.highlight : [];
  const clickHighlights = Array.isArray(clickCnt?.highlight) ? clickCnt.highlight : [];
  return playAnalysis.length > 0 || convertHighlights.length > 0 || clickHighlights.length > 0;
}

function getQualityGatePayload(raw: Record<string, any>): Record<string, any> {
  return isPlainObject(raw?.qualityGate) ? raw.qualityGate : {};
}

function isQualityAssessed(raw: Record<string, any>): boolean {
  const qualityGate = getQualityGatePayload(raw);
  if (Object.keys(qualityGate).length > 0) return true;
  return raw.contentViable === true || raw.contentViable === false;
}

function isViableForPatternAnalysis(raw: Record<string, any>): boolean {
  const qualityGate = getQualityGatePayload(raw);
  const viable =
    raw.contentViable === true ||
    qualityGate.viable === true;
  const confidence = firstNumber(
    raw.qualityConfidence,
    qualityGate.confidence
  );
  return Boolean(viable) && (confidence ?? 0) >= QUALITY_CONFIDENCE_THRESHOLD;
}

function getCoverage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function formatCompletenessReason(stats: AdCompleteness): string {
  if (stats.totalAds === 0) {
    return "No ads found for this run.";
  }
  if (stats.assessedAds === 0) {
    return "No quality assessments found. Run quality gate first.";
  }
  if (stats.viableAds === 0) {
    return "No viable ads. Run quality gate first.";
  }
  return "Pattern analysis requirements not met.";
}

function extractJsonFromText(text: string): any {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Pattern analysis returned no JSON");
  }
  return JSON.parse(match[0]);
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizePatternOutput(payload: any) {
  return {
    hookPatterns: safeArray(payload?.hookPatterns),
    messagePatterns: safeArray(payload?.messagePatterns),
    textOverlayPatterns: safeArray(payload?.textOverlayPatterns),
    ctaPatterns: safeArray(payload?.ctaPatterns),
    timingPatterns: safeArray(payload?.timingPatterns),
    clusters: safeArray(payload?.clusters),
  };
}

function extractAdTitle(raw: Record<string, any>) {
  return (
    firstString(raw?.ad_title, raw?.title, raw?.headline, raw?.adTitle) ?? "Untitled Ad"
  );
}

function extractEngagement(raw: Record<string, any>) {
  return (
    (firstNumber(raw?.like, raw?.likes, raw?.metrics?.likes) ?? 0) +
    (firstNumber(raw?.comment, raw?.comments, raw?.metrics?.comments) ?? 0) +
    (firstNumber(raw?.share, raw?.shares, raw?.metrics?.shares) ?? 0)
  );
}

function extractCtr(raw: Record<string, any>) {
  return firstNumber(raw?.ctr, raw?.metrics?.ctr);
}

function extractCost(raw: Record<string, any>) {
  return firstNumber(raw?.cost, raw?.metrics?.cost, raw?.spend, raw?.metrics?.spend);
}

function toSecond(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  if (isPlainObject(value)) {
    const n = firstNumber(value?.second, value?.time, value?.timestamp, value?.value);
    return n === null ? null : Math.round(n);
  }
  return null;
}

function extractRetention3s(raw: Record<string, any>): number | null {
  const { playRetain } = getKeyframeMetrics(raw);
  const analysis = Array.isArray(playRetain?.analysis) ? playRetain.analysis : [];
  const point3s = analysis.find((row: any) => firstNumber(row?.second, row?.t) === 3);
  return firstNumber(point3s?.value, analysis[2]?.value, raw?.metrics?.retention_3s);
}

function extractConversionHighlightSeconds(raw: Record<string, any>): number[] {
  const { convertCnt } = getKeyframeMetrics(raw);
  const highlights = Array.isArray(convertCnt?.highlight) ? convertCnt.highlight : [];
  const seconds: number[] = [];
  for (const value of highlights as unknown[]) {
    const second = toSecond(value);
    if (second !== null) {
      seconds.push(second);
    }
  }
  return Array.from(new Set<number>(seconds)).sort((a, b) => a - b);
}

function mapHighlightToText(raw: Record<string, any>, second: number): string {
  const frames = Array.isArray(raw?.ocrFrames) ? raw.ocrFrames : [];
  const exact = frames.find((frame: any) => toSecond(frame?.second) === second);
  if (exact && asString(exact?.text)) return asString(exact.text) as string;

  const nearest = frames
    .map((frame: any) => ({
      text: asString(frame?.text),
      second: toSecond(frame?.second),
    }))
    .filter((frame: any) => frame.text && frame.second !== null)
    .sort((a: any, b: any) => Math.abs(a.second - second) - Math.abs(b.second - second))[0];

  return nearest?.text ?? "no text overlay";
}

function buildAnalysisPrompt(ads: AdForAnalysis[]): string {
  const adBlocks = ads.map((ad) => {
    const raw = ad.rawJson;
    const title = extractAdTitle(raw);
    const ctr = extractCtr(raw);
    const engagement = extractEngagement(raw);
    const cost = extractCost(raw);
    const transcript = asString(raw?.transcript) ?? "";
    const ocrFrames = Array.isArray(raw?.ocrFrames) ? raw.ocrFrames : [];
    const retention3s = extractRetention3s(raw);
    const conversionHighlights = extractConversionHighlightSeconds(raw);
    const conversionLines = conversionHighlights.length
      ? conversionHighlights
          .map((second) => `Second ${second}: ${mapHighlightToText(raw, second)}`)
          .join("\n")
      : "No conversion highlight data";

    const ocrFrameLines = ocrFrames.length
      ? ocrFrames
          .map((frame: any) => `Second ${toSecond(frame?.second) ?? "?"}: "${asString(frame?.text) ?? ""}"`)
          .join("\n")
      : "No OCR frames";

    return `AD_ID: ${ad.id}
AD: ${title}
PERFORMANCE:
- CTR: ${ctr ?? "N/A"}
- Engagement: ${engagement}
- Cost: ${cost ?? "N/A"}

TRANSCRIPT (what they say):
${transcript || "N/A"}

OCR TEXT (text overlays at high-converting moments):
${ocrFrameLines}

HOOK PERFORMANCE (first 3 seconds):
- Retention: ${retention3s ?? "N/A"}

CONVERSION MOMENTS (when people clicked/converted):
${conversionLines}`;
  });

  return `Analyze these TikTok ads and identify patterns:

${adBlocks.join("\n---\n")}

Identify:
1. HOOK PATTERNS: What do the best-performing first 3 seconds have in common?
2. MESSAGE PATTERNS: What themes/pain points appear in high-CTR ads?
3. TEXT OVERLAY PATTERNS: What text appears at conversion moments?
4. CTA PATTERNS: What calls-to-action drive clicks?
5. TIMING PATTERNS: When should key messages appear for best results?
6. CREATIVE CLUSTERS: Group similar ads by performance level

Return structured JSON with:
{
  "hookPatterns": [{"pattern": "...", "exampleAds": [...], "avgCTR": ...}],
  "messagePatterns": [...],
  "textOverlayPatterns": [...],
  "ctaPatterns": [...],
  "timingPatterns": [...],
  "clusters": [{"name": "...", "adIds": [...], "characteristics": "..."}]
}`;
}

async function loadAdsForRun(
  args: AdCompletenessArgs,
  options?: { onlyViable?: boolean }
): Promise<AdForAnalysis[]> {
  const { projectId, runId } = args;
  const onlyViable = options?.onlyViable === true;
  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      ...(runId ? { job: { is: { runId } } } : {}),
    },
    select: {
      id: true,
      rawJson: true,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const normalized = assets.map((asset) => ({
    id: asset.id,
    rawJson: isPlainObject(asset.rawJson) ? asset.rawJson : {},
  }));

  if (!onlyViable) return normalized;
  return normalized.filter((asset) => isViableForPatternAnalysis(asset.rawJson));
}

export async function getAdDataCompleteness(args: AdCompletenessArgs): Promise<AdCompleteness> {
  const ads = await loadAdsForRun(args, { onlyViable: false });
  const totalAds = ads.length;
  const withTranscript = ads.filter((ad) => hasTranscript(ad.rawJson)).length;
  const withOcr = ads.filter((ad) => hasOcr(ad.rawJson)).length;
  const withKeyframe = ads.filter((ad) => hasKeyframe(ad.rawJson)).length;
  const withAllData = ads.filter(
    (ad) => hasTranscript(ad.rawJson) && hasOcr(ad.rawJson) && hasKeyframe(ad.rawJson)
  ).length;
  const assessedAds = ads.filter((ad) => isQualityAssessed(ad.rawJson)).length;
  const viableAds = ads.filter((ad) => isViableForPatternAnalysis(ad.rawJson)).length;
  const rejectedAds = Math.max(0, assessedAds - viableAds);

  const transcriptCoverage = getCoverage(withTranscript, totalAds);
  const ocrCoverage = getCoverage(withOcr, totalAds);
  const keyframeCoverage = getCoverage(withKeyframe, totalAds);

  const canRun = viableAds > 0;

  const result: AdCompleteness = {
    totalAds,
    withTranscript,
    withOcr,
    withKeyframe,
    withAllData,
    transcriptCoverage,
    ocrCoverage,
    keyframeCoverage,
    assessedAds,
    viableAds,
    rejectedAds,
    confidenceThreshold: QUALITY_CONFIDENCE_THRESHOLD,
    canRun,
    reason: null,
  };

  if (!canRun) {
    result.reason = formatCompletenessReason(result);
  }

  return result;
}

export async function runPatternAnalysis(args: {
  projectId: string;
  runId?: string | null;
  jobId: string;
}): Promise<{
  ok: true;
  runId: string | null;
  adsAnalyzed: number;
  completeness: AdCompleteness;
  patterns: ReturnType<typeof normalizePatternOutput>;
  summary: string;
}> {
  const { projectId, runId, jobId } = args;
  if (!cfg.raw("ANTHROPIC_API_KEY")) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const completeness = await getAdDataCompleteness({ projectId, runId });
  if (!completeness.canRun) {
    throw new Error(completeness.reason ?? "Pattern analysis requirements not met");
  }

  const ads = await loadAdsForRun({ projectId, runId }, { onlyViable: true });
  const completeAds = ads.slice(0, MAX_ADS_FOR_ANALYSIS);

  if (completeAds.length === 0) {
    throw new Error("No viable ads. Run quality gate first.");
  }

  const analysisPrompt = buildAnalysisPrompt(completeAds);
  const response: any = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{ role: "user", content: analysisPrompt }],
  });

  const textBlocks = Array.isArray(response?.content)
    ? response.content.filter((block: any) => block?.type === "text")
    : [];
  const outputText = textBlocks.map((block: any) => String(block.text ?? "")).join("\n");
  const parsed = extractJsonFromText(outputText);
  const patterns = normalizePatternOutput(parsed);

  const summary = `Identified ${patterns.hookPatterns.length} hook patterns, ${patterns.messagePatterns.length} message patterns`;

  await prisma.$transaction(async (tx) => {
    await tx.adPatternResult.create({
      data: {
        projectId,
        jobId,
        summary,
        rawJson: {
          runId: runId ?? null,
          adsAnalyzed: completeAds.length,
          completeness,
          patterns,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    const references = [
      ...patterns.hookPatterns.map((entry: any) => ({ source: "hook", metadata: entry })),
      ...patterns.messagePatterns.map((entry: any) => ({ source: "message", metadata: entry })),
      ...patterns.textOverlayPatterns.map((entry: any) => ({ source: "text_overlay", metadata: entry })),
      ...patterns.ctaPatterns.map((entry: any) => ({ source: "cta", metadata: entry })),
      ...patterns.timingPatterns.map((entry: any) => ({ source: "timing", metadata: entry })),
      ...patterns.clusters.map((entry: any) => ({ source: "cluster", metadata: entry })),
    ].slice(0, 200);

    if (references.length > 0) {
      await tx.adPatternReference.createMany({
        data: references.map((entry) => ({
          projectId,
          source: entry.source,
          metadata: entry.metadata as any,
        })),
      });
    }
  });

  return {
    ok: true,
    runId: runId ?? null,
    adsAnalyzed: completeAds.length,
    completeness,
    patterns,
    summary,
  };
}
