import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({
  apiKey: cfg.raw("ANTHROPIC_API_KEY"),
  timeout: 60000,
});

const QUALITY_CONFIDENCE_THRESHOLD = 70;
const MAX_ADS_FOR_ANALYSIS = 80;
const PATTERN_ANALYSIS_SYSTEM_PROMPT =
  "You are a performance creative analyst. Your primary job is to identify transferable psychological mechanisms, not product-specific tactics. Abstract every recommendation so it can generalize across categories, and ground guidance in clear cognitive triggers (for example: pattern interrupt, loss aversion, social proof cascade, authority transfer, time compression, confession dissonance).";

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

function safeObject(value: unknown): Record<string, any> {
  return isPlainObject(value) ? value : {};
}

function splitTranscriptIntoSentences(transcript: string): string[] {
  const normalized = transcript
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 0 ? sentences : [normalized];
}

function countWords(text: string): number {
  const matches = text.match(/[A-Za-z0-9']+/g);
  return matches ? matches.length : 0;
}

function roundTo(value: number, digits = 3): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function classifyOpeningSentenceStructure(sentence: string): string {
  const normalized = sentence.trim();
  if (!normalized) return "unknown";
  const lower = normalized.toLowerCase();

  if (normalized.includes("?")) return "question";
  if (normalized.includes("!")) return "exclamation";
  if (/^(i\s|i'm\s|i’ve\s|i've\s|i thought|i used to|i was)\b/.test(lower)) {
    return "first_person_confession";
  }
  if (/^(stop|don't|do not|never|try|imagine|watch|meet)\b/.test(lower)) {
    return "imperative_command";
  }
  if (/^(when|if|because|before|after|once)\b/.test(lower)) {
    return "conditional_setup";
  }
  return "declarative_statement";
}

function analyzeTranscriptCadence(transcript: string) {
  const sentences = splitTranscriptIntoSentences(transcript);
  const sentenceLengths = sentences.map((sentence) => countWords(sentence));
  const sentenceCount = sentenceLengths.length;
  const totalWords = sentenceLengths.reduce((sum, len) => sum + len, 0);
  const averageSentenceLength = sentenceCount > 0 ? totalWords / sentenceCount : 0;
  const sentenceLengthVariance =
    sentenceCount > 0
      ? sentenceLengths.reduce((sum, len) => {
          const delta = len - averageSentenceLength;
          return sum + delta * delta;
        }, 0) / sentenceCount
      : 0;

  const ellipses = (transcript.match(/\.\.\./g) || []).length;
  const withoutEllipses = transcript.replace(/\.\.\./g, "");
  const periods = (withoutEllipses.match(/\./g) || []).length;
  const dashes = (transcript.match(/—|–| - /g) || []).length;
  const questionMarks = (transcript.match(/\?/g) || []).length;
  const questionSentences = sentences.filter((sentence) => sentence.includes("?")).length;
  const openingSentence = sentences[0] ?? "";
  const openingSentenceStructure = classifyOpeningSentenceStructure(openingSentence);

  return {
    sentenceCount,
    totalWords,
    averageSentenceLength: roundTo(averageSentenceLength, 2),
    sentenceLengthVariance: roundTo(sentenceLengthVariance, 2),
    pauseIndicators: {
      periods,
      dashes,
      ellipses,
      total: periods + dashes + ellipses,
    },
    questionUsageFrequency: sentenceCount > 0 ? roundTo(questionSentences / sentenceCount, 3) : 0,
    questionMarks,
    openingSentence,
    openingSentenceStructure,
    sentenceLengths,
  };
}

type VoiceCadenceAdMetrics = {
  adId: string;
  averageSentenceLength: number;
  sentenceLengthVariance: number;
  pauseIndicators: {
    periods: number;
    dashes: number;
    ellipses: number;
    total: number;
  };
  questionUsageFrequency: number;
  openingSentenceStructure: string;
  openingSentence: string;
  sentenceCount: number;
  totalWords: number;
  questionMarks: number;
  sentenceLengths: number[];
};

function buildVoiceCadenceGuidance(
  winningAds: any[],
  transcriptByAdId: Map<string, string>,
): Record<string, any> {
  const perWinningAd = winningAds
    .map((entry: any, index: number) => {
      const winningAd = safeObject(entry);
      const adId =
        firstString(winningAd?.adId, winningAd?.id, winningAd?.assetId) ||
        `winning_ad_${index + 1}`;
      const transcript =
        firstString(winningAd?.fullTranscript, winningAd?.transcript, winningAd?.script) ||
        transcriptByAdId.get(adId) ||
        "";

      if (!transcript) return null;
      const cadence = analyzeTranscriptCadence(transcript);
      return {
        adId,
        averageSentenceLength: cadence.averageSentenceLength,
        sentenceLengthVariance: cadence.sentenceLengthVariance,
        pauseIndicators: cadence.pauseIndicators,
        questionUsageFrequency: cadence.questionUsageFrequency,
        openingSentenceStructure: cadence.openingSentenceStructure,
        openingSentence: cadence.openingSentence,
        sentenceCount: cadence.sentenceCount,
        totalWords: cadence.totalWords,
        questionMarks: cadence.questionMarks,
        sentenceLengths: cadence.sentenceLengths,
      };
    })
    .filter(
      (entry: VoiceCadenceAdMetrics | null): entry is VoiceCadenceAdMetrics =>
        entry !== null
    );

  if (perWinningAd.length === 0) {
    return {
      source: "winning_ad_transcripts",
      adsWithTranscript: 0,
      averageSentenceLength: 0,
      sentenceLengthVariance: 0,
      pauseIndicators: {
        periods: 0,
        dashes: 0,
        ellipses: 0,
        total: 0,
      },
      questionUsageFrequency: 0,
      openingSentenceStructure: {
        dominant: "unknown",
        distribution: {},
        examples: [],
      },
      perWinningAd: [],
    };
  }

  let totalSentences = 0;
  let totalWords = 0;
  let periods = 0;
  let dashes = 0;
  let ellipses = 0;
  let totalQuestions = 0;
  const allSentenceLengths: number[] = [];
  const openingCounts: Record<string, number> = {};

  for (const ad of perWinningAd) {
    if (!ad) continue;
    totalSentences += Number(ad?.sentenceCount || 0);
    totalWords += Number(ad?.totalWords || 0);
    periods += Number(ad?.pauseIndicators?.periods || 0);
    dashes += Number(ad?.pauseIndicators?.dashes || 0);
    ellipses += Number(ad?.pauseIndicators?.ellipses || 0);
    totalQuestions += Number(ad?.questionMarks || 0);
    const lengths = Array.isArray(ad?.sentenceLengths) ? ad.sentenceLengths : [];
    allSentenceLengths.push(
      ...lengths
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry)),
    );
    const openingKey = ad?.openingSentenceStructure || "unknown";
    openingCounts[openingKey] = (openingCounts[openingKey] || 0) + 1;
  }

  const averageSentenceLength = totalSentences > 0 ? totalWords / totalSentences : 0;
  const sentenceLengthVariance =
    allSentenceLengths.length > 0
      ? allSentenceLengths.reduce((sum, len) => {
          const delta = len - averageSentenceLength;
          return sum + delta * delta;
        }, 0) / allSentenceLengths.length
      : 0;
  const dominantOpening = Object.entries(openingCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  return {
    source: "winning_ad_transcripts",
    adsWithTranscript: perWinningAd.length,
    averageSentenceLength: roundTo(averageSentenceLength, 2),
    sentenceLengthVariance: roundTo(sentenceLengthVariance, 2),
    pauseIndicators: {
      periods,
      dashes,
      ellipses,
      total: periods + dashes + ellipses,
    },
    questionUsageFrequency: totalSentences > 0 ? roundTo(totalQuestions / totalSentences, 3) : 0,
    openingSentenceStructure: {
      dominant: dominantOpening,
      distribution: openingCounts,
      examples: perWinningAd
        .map((ad) => asString(ad?.openingSentence))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 3),
    },
    perWinningAd,
  };
}

function normalizePatternOutput(payload: any, transcriptByAdId: Map<string, string>) {
  const winningAds = safeArray(payload?.winningAds);
  const prescriptiveGuidance = safeObject(payload?.prescriptiveGuidance);
  const avoidPatterns = safeArray(payload?.avoidPatterns);
  const voiceCadence = buildVoiceCadenceGuidance(winningAds, transcriptByAdId);
  prescriptiveGuidance.voiceCadence = voiceCadence;

  const hookPatterns = safeArray(payload?.hookPatterns);
  const messagePatterns = safeArray(payload?.messagePatterns);
  const textOverlayPatterns = safeArray(payload?.textOverlayPatterns);
  const ctaPatterns = safeArray(payload?.ctaPatterns);
  const timingPatterns = safeArray(payload?.timingPatterns);
  const clusters = safeArray(payload?.clusters);

  return {
    winningAds,
    prescriptiveGuidance,
    avoidPatterns,
    hookPatterns:
      hookPatterns.length > 0
        ? hookPatterns
        : (prescriptiveGuidance.hook ? [{ pattern: prescriptiveGuidance.hook }] : []),
    messagePatterns:
      messagePatterns.length > 0
        ? messagePatterns
        : (prescriptiveGuidance.body ? [{ pattern: prescriptiveGuidance.body }] : []),
    textOverlayPatterns:
      textOverlayPatterns.length > 0
        ? textOverlayPatterns
        : (prescriptiveGuidance.textOverlays ? [{ pattern: prescriptiveGuidance.textOverlays }] : []),
    ctaPatterns:
      ctaPatterns.length > 0
        ? ctaPatterns
        : (prescriptiveGuidance.cta ? [{ pattern: prescriptiveGuidance.cta }] : []),
    timingPatterns:
      timingPatterns.length > 0
        ? timingPatterns
        : (prescriptiveGuidance.body ? [{ pattern: prescriptiveGuidance.body }] : []),
    clusters,
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

function extractRetentionCurve(raw: Record<string, any>): string {
  const { playRetain } = getKeyframeMetrics(raw);
  const analysis = Array.isArray(playRetain?.analysis) ? playRetain.analysis : [];
  const points = analysis
    .map((row: any) => {
      const second = firstNumber(row?.second, row?.t);
      const value = firstNumber(row?.value);
      if (second === null || value === null) return null;
      return [Math.round(second), value];
    })
    .filter((row: unknown): row is [number, number] => Array.isArray(row));
  if (points.length === 0) return "N/A";
  return JSON.stringify(points);
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
  const adBlocks = ads
    .map((ad) => {
    const raw = ad.rawJson;
    const title = extractAdTitle(raw);
    const ctr = extractCtr(raw);
    const retentionCurve = extractRetentionCurve(raw);
    const transcript = asString(raw?.transcript) ?? "";
    const ocrFrames = Array.isArray(raw?.ocrFrames) ? raw.ocrFrames : [];
    const visualDescription =
      asString(raw?.visualDescription) ??
      "Describe shot sequence based on OCR/transcript";
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

      return `
AD_ID: ${ad.id}
TITLE: ${title}
CTR: ${ctr ?? "N/A"}
RETENTION_CURVE: ${retentionCurve || "N/A"}

FULL_TRANSCRIPT:
${transcript || "N/A"}

OCR_TEXT_WITH_TIMING:
${ocrFrameLines}

VISUAL_STRUCTURE:
${visualDescription || "Describe shot sequence based on OCR/transcript"}

CONVERSION_MOMENTS:
${conversionLines}
`;
    })
    .join("\n---\n");

  return `Analyze these ${ads.length} TikTok ads. Extract psychologically grounded, cross-category mechanisms.

${adBlocks}

Output JSON:
{
  "winningAds": [
    {
      "adId": "...",
      "ctr": 0.21,
      "retentionCurve": [[0,1.0], [3,0.745], [10,0.58]],
      "fullTranscript": "verbatim script with timestamps",
      "ocrText": "exact overlays with timestamps",
      "visualDescription": "shot-by-shot breakdown",
      "whyItWorks": "specific mechanisms that drove performance"
    }
  ],
  "prescriptiveGuidance": {
    "hook": "Exact first 2s structure with example phrase",
    "body": "Second-by-second content map (e.g., 3-8s: establish authority, 12-13s: introduce solution)",
    "cta": "Exact CTA structure with example phrase",
    "textOverlays": "When to show text, exact phrasing patterns",
    "voiceCadence": {
      "averageSentenceLength": 11.2,
      "sentenceLengthVariance": 9.8,
      "pauseIndicators": { "periods": 14, "dashes": 3, "ellipses": 2 },
      "questionUsageFrequency": 0.18,
      "openingSentenceStructure": "first_person_confession"
    },
    "visualFlow": "Shot sequence that maximizes retention",
    // psychologicalMechanism: Name the cognitive trigger the pattern exploits.
    "psychologicalMechanism": "Name the specific cognitive trigger used (e.g., pattern interrupt, loss aversion, social proof cascade, authority transfer, time compression, confession dissonance)",
    // transferFormula: Provide a product-agnostic formula for reuse across categories.
    "transferFormula": "[Abstract component 1] + [Abstract component 2] + [Abstract component 3] = [mechanism label]"
  },
  "avoidPatterns": [
    {
      "pattern": "what low performers did wrong",
      "adIds": ["..."],
      "whyItFailed": "specific retention/CTR impact"
    }
  ]
}

Focus: Prioritize adaptable mechanisms over category-specific tactics. Explain why each mechanism works psychologically and keep formulas product-agnostic.`;
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
    system: PATTERN_ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: analysisPrompt }],
  });

  const textBlocks = Array.isArray(response?.content)
    ? response.content.filter((block: any) => block?.type === "text")
    : [];
  const outputText = textBlocks.map((block: any) => String(block.text ?? "")).join("\n");
  const parsed = extractJsonFromText(outputText);
  const transcriptByAdId = new Map<string, string>(
    completeAds
      .map((ad) => {
        const transcript = asString(ad.rawJson?.transcript);
        return transcript ? [ad.id, transcript] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
  const patterns = normalizePatternOutput(parsed, transcriptByAdId);

  const summary = patterns.winningAds.length > 0
    ? `Identified ${patterns.winningAds.length} winning ads and ${patterns.avoidPatterns.length} avoid patterns`
    : `Identified ${patterns.hookPatterns.length} hook patterns, ${patterns.messagePatterns.length} message patterns`;

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
      ...patterns.winningAds.map((entry: any) => ({ source: "winning_ad", metadata: entry })),
      ...(Object.keys(patterns.prescriptiveGuidance).length > 0
        ? [{ source: "prescriptive_guidance", metadata: patterns.prescriptiveGuidance }]
        : []),
      ...patterns.avoidPatterns.map((entry: any) => ({ source: "avoid_pattern", metadata: entry })),
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
