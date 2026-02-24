import Anthropic from "@anthropic-ai/sdk";
import { AdPlatform } from "@prisma/client";
import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";

type QualityIssue =
  | "ui_chrome"
  | "music_lyrics"
  | "insufficient_content"
  | "valid"
  | "foreign_language"
  | "corrupted_text";

type QualityAssessment = {
  viable: boolean;
  primaryIssue: QualityIssue;
  confidence: number;
  reason: string;
};

const DEFAULT_QUALITY_MODEL = "claude-sonnet-4-5-20250929";
const QUALITY_MODEL = (() => {
  const configured = cfg.raw("ANTHROPIC_QUALITY_MODEL");
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_QUALITY_MODEL;
})();
const QUALITY_CONFIDENCE_THRESHOLD = 70;

const anthropic = new Anthropic({
  apiKey: cfg.raw("ANTHROPIC_API_KEY"),
  timeout: 60000,
});

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
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

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractViewCount(raw: Record<string, any>): number {
  const metrics = asObject(raw.metrics);
  const count = firstNumber(
    metrics.views,
    metrics.view,
    metrics.plays,
    metrics.play,
    metrics.impressions,
    raw.views,
    raw.view,
    raw.plays,
    raw.play,
  );
  if (count === null || count < 0) return 0;
  return Math.round(count);
}

function extractJsonObject(text: string): Record<string, any> {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    return asObject(parsed);
  } catch {
    return {};
  }
}

function normalizeAssessment(payload: Record<string, any>): QualityAssessment {
  const issue = String(payload.primaryIssue ?? "corrupted_text").trim() as QualityIssue;
  const validIssues: QualityIssue[] = [
    "ui_chrome",
    "music_lyrics",
    "insufficient_content",
    "valid",
    "foreign_language",
    "corrupted_text",
  ];
  const normalizedIssue = validIssues.includes(issue) ? issue : "corrupted_text";
  return {
    viable: Boolean(payload.viable),
    primaryIssue: normalizedIssue,
    confidence: clampConfidence(payload.confidence),
    reason: firstString(payload.reason) ?? "No reason provided",
  };
}

async function assessAdQuality(ocrText: string | null, transcript: string | null): Promise<QualityAssessment> {
  const ocrBlock = (ocrText ?? "none").slice(0, 4000);
  const transcriptBlock = (transcript ?? "none").slice(0, 4000);

  const response = await anthropic.messages.create({
    model: QUALITY_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Data quality filter for ad content analysis.

OCR: ${ocrBlock}
Transcript: ${transcriptBlock}

REJECT if:
- UI chrome/repeated platform text
- Song lyrics without product mentions
- Corrupted/garbled text
- Non-English
- <20 words actual content

ACCEPT if:
- Ad copy or voiceover script
- Product/brand/CTA mentions
- Benefit claims/testimonials

JSON only:
{
  "viable": bool,
  "primaryIssue": "ui_chrome"|"music_lyrics"|"insufficient_content"|"valid"|"foreign_language"|"corrupted_text",
  "confidence": 0-100,
  "reason": "one sentence"
}`,
      },
    ],
  });

  const text = response.content.find((entry) => entry.type === "text");
  const parsed = extractJsonObject(text?.type === "text" ? text.text : "{}");
  return normalizeAssessment(parsed);
}

export async function runAdQualityGate(args: {
  projectId: string;
  jobId: string;
  runId: string;
  forceReprocess?: boolean;
}) {
  const { projectId, jobId, runId, forceReprocess = false } = args;
  void jobId;

  if (!cfg.raw("ANTHROPIC_API_KEY")) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!runId || !String(runId).trim()) {
    throw new Error("runId is required for quality gate");
  }

  const assets = await prisma.adAsset.findMany({
    where: {
      projectId,
      platform: AdPlatform.TIKTOK,
      job: {
        is: {
          runId,
        },
      },
    },
    select: {
      id: true,
      rawJson: true,
      contentViable: true,
      qualityConfidence: true,
      qualityReason: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates = assets.filter((asset) => {
    const raw = asObject(asset.rawJson);
    const alreadyAssessed = Boolean(raw.qualityGate && typeof raw.qualityGate === "object");
    const needsColumnBackfill =
      alreadyAssessed &&
      (asset.contentViable === null ||
        asset.qualityConfidence === null ||
        !firstString(asset.qualityReason));
    if (!forceReprocess && alreadyAssessed && !needsColumnBackfill) return false;
    const transcript = firstString(raw.transcript);
    const ocrText = firstString(raw.ocrText);
    return Boolean(transcript || ocrText);
  });

  if (candidates.length === 0) {
    return {
      totalAssets: assets.length,
      assessed: 0,
      viable: 0,
      rejected: 0,
      summary: "No ads to assess",
      confidenceThreshold: QUALITY_CONFIDENCE_THRESHOLD,
    };
  }

  let assessed = 0;
  let viable = 0;
  const rejectionReasons: Record<string, number> = {};

  for (const asset of candidates) {
    const raw = asObject(asset.rawJson);
    const qualityGate = asObject(raw.qualityGate);
    const alreadyAssessed = Boolean(raw.qualityGate && typeof raw.qualityGate === "object");
    const transcript = firstString(raw.transcript);
    const ocrText = firstString(raw.ocrText);

    if (!forceReprocess && alreadyAssessed) {
      const accepted = asBoolean(raw.contentViable) === true || asBoolean(qualityGate.viable) === true;
      const confidence = clampConfidence(firstNumber(raw.qualityConfidence, qualityGate.confidence));
      const qualityIssue = (firstString(raw.qualityIssue, qualityGate.issue) ?? "valid") as QualityIssue;
      const qualityReason = firstString(raw.qualityReason, qualityGate.reason) ?? "Backfilled from quality gate metadata";
      const viabilityScore = accepted ? confidence / 100 : 0;
      const transcriptText = typeof transcript === "string" ? transcript.trim() : "";
      const transcriptWordCount = transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0;
      const hasMeaningfulTranscript = transcriptText.length > 100 && transcriptWordCount >= 20;
      const swipeCandidate = viabilityScore > 0.85 && hasMeaningfulTranscript;

      await prisma.adAsset.update({
        where: { id: asset.id },
        data: {
          contentViable: accepted,
          qualityIssue,
          qualityConfidence: confidence,
          qualityReason,
          swipeCandidate,
        },
      });

      assessed += 1;
      if (accepted) viable += 1;
      else rejectionReasons[qualityIssue] = (rejectionReasons[qualityIssue] || 0) + 1;
      continue;
    }

    const assessment = await assessAdQuality(ocrText, transcript);
    const accepted = assessment.viable && assessment.confidence >= QUALITY_CONFIDENCE_THRESHOLD;
    const viabilityScore = assessment.viable ? assessment.confidence / 100 : 0;
    const viewCount = extractViewCount(raw);
    const transcriptText = typeof raw.transcript === "string" ? raw.transcript.trim() : "";
    const transcriptWordCount = transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0;
    const hasMeaningfulTranscript = transcriptText.length > 100 && transcriptWordCount >= 20;
    const swipeCandidate =
      viabilityScore > 0.85 && hasMeaningfulTranscript;

    await prisma.adAsset.update({
      where: { id: asset.id },
      data: {
        contentViable: accepted,
        qualityIssue: assessment.primaryIssue,
        qualityConfidence: assessment.confidence,
        qualityReason: assessment.reason,
        rawJson: {
          ...raw,
          contentViable: accepted,
          qualityIssue: assessment.primaryIssue,
          qualityConfidence: assessment.confidence,
          qualityReason: assessment.reason,
          viabilityScore,
          viewCount,
          swipeCandidate,
          qualityGate: {
            viable: accepted,
            rawViable: assessment.viable,
            issue: assessment.primaryIssue,
            confidence: assessment.confidence,
            reason: assessment.reason,
            viabilityScore,
            confidenceThreshold: QUALITY_CONFIDENCE_THRESHOLD,
            swipeCandidate,
            assessedAt: new Date().toISOString(),
          },
        } as any,
        swipeCandidate,
      },
    });

    assessed += 1;
    if (accepted) {
      viable += 1;
      continue;
    }

    rejectionReasons[assessment.primaryIssue] = (rejectionReasons[assessment.primaryIssue] || 0) + 1;
  }

  const rejected = assessed - viable;
  const reasonSummary = Object.entries(rejectionReasons)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(", ");
  const summary = `${assessed} ads assessed: ${viable} viable, ${rejected} rejected${reasonSummary ? `. ${reasonSummary}` : ""}`;

  return {
    totalAssets: assets.length,
    assessed,
    viable,
    rejected,
    summary,
    confidenceThreshold: QUALITY_CONFIDENCE_THRESHOLD,
  };
}
