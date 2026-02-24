// lib/scriptGenerationService.ts
import { cfg } from "@/lib/config";
import Anthropic from "@anthropic-ai/sdk";
import prisma from './prisma.ts';
import { JobStatus, JobType, Prisma, ScriptStatus } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';
import type { Job } from '@prisma/client';
import { guardedExternalCall } from './externalCallGuard.ts';
import { env, requireEnv } from './configGuard.ts';
import { flag, devNumber } from './flags.ts';
import { scaleBeatRatiosToduration, type BeatRatio } from "@/lib/analyzeSwipeTranscript";

const LLM_TIMEOUT_MS = Number(cfg.raw("LLM_TIMEOUT_MS") ?? 90_000);
console.log("[LLM] timeout config:", {
  raw: cfg.raw("LLM_TIMEOUT_MS"),
  resolved: LLM_TIMEOUT_MS,
});
const LLM_BREAKER_FAILS = Number(cfg.raw("LLM_BREAKER_FAILS") ?? 3);
const LLM_BREAKER_COOLDOWN_MS = Number(cfg.raw("LLM_BREAKER_COOLDOWN_MS") ?? 60_000);
const LLM_RETRIES = Number(cfg.raw("LLM_RETRIES") ?? 1);

type Pattern = {
  pattern_name: string;
  category: string;
  description?: string;
  example?: string;
  timing?: string;
  visual_notes?: string;
  occurrence_rate?: number | string;
  sample_count?: number;
  production_complexity?: string;
  standalone_viable?: boolean;
  can_coexist?: boolean;
  [key: string]: any;
};

type StackingRule = {
  combination: string[];
  synergy_type: string;
  performance_delta?: string;
  baseline_comparison?: string;
  reason?: string;
  [key: string]: any;
};

type AntiPattern = {
  pattern_name: string;
  why_it_fails?: string;
  converter_rate?: number;
  non_converter_rate?: number;
  rate_delta?: number;
  example?: string;
  [key: string]: any;
};

type ScriptJSON = {
  scenes: any[];
  vo_full?: string;
  word_count?: number;
  blocker_resolution_method?: string;
  pattern_application?: {
    hook_fidelity?: string;
    proof_fidelity?: string;
    synergy_utilized?: string;
  };
  [key: string]: any;
};

type ScriptValidationReport = {
  gatesPassed: boolean;
  warnings: string[];
  qualityScore: number;
  gateResults: {
    copyReadyPhrases: {
      passed: boolean;
      required: number;
      matchedCount: number;
      matchedPhrases: string[];
    };
    verifiedNumericClaims: {
      passed: boolean;
      extractedNumbers: string[];
      unmatchedNumbers: string[];
    };
    finalBeatOutcomeOverlap: {
      passed: boolean;
      overlapKeywords: string[];
      matchedKeywordCount: number;
    };
  };
};

type ScriptValidationInputs = {
  copyReadyPhrases: string[];
  verifiedNumericClaims: string[];
  successLooksLikeQuote: string;
};

type PromptInjectionValues = {
  productName: unknown;
  mechanismProcess: unknown;
  avatarAge: unknown;
  avatarGender: unknown;
  avatarJob: unknown;
  psychographics: unknown;
  goal: unknown;
  blockerFear: unknown;
  blockerQuote: unknown;
  hookPatternName: unknown;
  hookPatternExample: unknown;
  proofPatternName: unknown;
  proofPatternDescription: unknown;
  amplifySynergy: unknown;
  copyReadyPhrases: unknown;
  successLooksLikeQuote: unknown;
  buyTriggerQuote: unknown;
  buyTriggerSituation: unknown;
  lifeStage: unknown;
  urgencyLevel: unknown;
  competitorLandmineTopQuote: unknown;
  voiceCadenceConstraint: unknown;
};

type BeatPlanEntry = {
  label: string;
  duration: string;
  guidance?: string;
  formulaComponent?: string;
};

type StructuredProductIntelRow = {
  id: string;
  projectId: string;
  jobId: string;
  url: string;
  productName: string;
  tagline: string | null;
  keyFeatures: string[];
  ingredientsOrSpecs: string[];
  price: string | null;
  keyClaims: string[];
  targetAudience: string | null;
  usp: string | null;
  rawHtml: string | null;
  createdAt: Date;
};

type CustomerAnalysisContext = {
  jobId: string;
  runId: string | null;
  createdAt: Date;
  completedAt: Date;
};

type AvatarSelection = {
  avatar: any | null;
  customerAnalysis: CustomerAnalysisContext | null;
};

type PatternSelection = {
  patternResult: {
    jobId: string | null;
    createdAt: Date;
    rawJson: unknown;
    jobRunId: string | null;
    jobUpdatedAt: Date | null;
  } | null;
  source: "latest" | "after_customer_analysis";
};

type SwipeTemplate = {
  hookPattern: string;
  problemPattern: string;
  solutionPattern: string;
  ctaPattern: string;
  beatStructure: Array<{
    beat: string;
    duration: string;
    pattern: string;
  }>;
};

type SwipeFileSelection = {
  id: string;
  views: number | null;
  swipeMetadata: SwipeTemplate;
};

type ScriptStrategy = "swipe_template" | "research_formula";

type ProductCollectionJobContext = {
  id: string;
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
  payload: unknown;
};

type ProductIntelSelection = {
  productIntel: Record<string, unknown>;
  source: "product_collection" | "structured_table" | "legacy";
  sourceDate: Date | null;
  productCollectionJobId: string | null;
};

type ResearchSourcesUsed = {
  customerAnalysisJobId: string | null;
  customerAnalysisRunDate: string | null;
  patternAnalysisJobId: string | null;
  patternAnalysisRunDate: string | null;
  productIntelDate: string | null;
  swipeFileId: string | null;
  swipeFileViews: number | null;
  scriptStrategy: ScriptStrategy;
  requestedSwipeTemplateAdId: string | null;
};

function toIso(date: Date | null | undefined): string | null {
  return date instanceof Date ? date.toISOString() : null;
}

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
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

function firstStringInArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const normalized = asString(entry);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeSwipeTemplate(value: unknown): SwipeTemplate | null {
  const raw = asObject(value);
  if (!raw) return null;

  const hookPattern = asString(raw.hookPattern);
  const problemPattern = asString(raw.problemPattern);
  const solutionPattern = asString(raw.solutionPattern);
  const ctaPattern = asString(raw.ctaPattern);

  if (!hookPattern || !problemPattern || !solutionPattern || !ctaPattern) {
    return null;
  }

  const rawBeatStructure = Array.isArray(raw.beatStructure) ? raw.beatStructure : [];
  const beatStructure = rawBeatStructure
    .map((entry) => {
      const beat = asObject(entry);
      if (!beat) return null;
      const label = asString(beat.beat);
      const duration = asString(beat.duration);
      const pattern = asString(beat.pattern);
      if (!label || !duration || !pattern) return null;
      return {
        beat: label,
        duration,
        pattern,
      };
    })
    .filter((entry): entry is { beat: string; duration: string; pattern: string } => Boolean(entry))
    .slice(0, 8);

  return {
    hookPattern,
    problemPattern,
    solutionPattern,
    ctaPattern,
    beatStructure,
  };
}

function extractSwipeViews(rawJson: unknown): number | null {
  const raw = asObject(rawJson);
  if (!raw) return null;
  const metrics = asObject(raw.metrics);
  const qualityGate = asObject(raw.qualityGate);
  return firstNumber(
    raw.views,
    raw.view,
    raw.plays,
    metrics?.views,
    metrics?.view,
    metrics?.plays,
    qualityGate?.viewCount,
  );
}

function escapePromptJsonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function markMissingPromptFields(values: PromptInjectionValues): PromptInjectionValues {
  const normalize = (value: unknown): unknown => {
    if (value === undefined || value === null) return "MISSING";
    if (typeof value === "string" && value.trim() === "") return "MISSING";
    return value;
  };

  return {
    productName: normalize(values.productName),
    mechanismProcess: normalize(values.mechanismProcess),
    avatarAge: normalize(values.avatarAge),
    avatarGender: normalize(values.avatarGender),
    avatarJob: normalize(values.avatarJob),
    psychographics: normalize(values.psychographics),
    goal: normalize(values.goal),
    blockerFear: normalize(values.blockerFear),
    blockerQuote: normalize(values.blockerQuote),
    hookPatternName: normalize(values.hookPatternName),
    hookPatternExample: normalize(values.hookPatternExample),
    proofPatternName: normalize(values.proofPatternName),
    proofPatternDescription: normalize(values.proofPatternDescription),
    amplifySynergy: normalize(values.amplifySynergy),
    copyReadyPhrases: normalize(values.copyReadyPhrases),
    successLooksLikeQuote: normalize(values.successLooksLikeQuote),
    buyTriggerQuote: normalize(values.buyTriggerQuote),
    buyTriggerSituation: normalize(values.buyTriggerSituation),
    lifeStage: normalize(values.lifeStage),
    urgencyLevel: normalize(values.urgencyLevel),
    competitorLandmineTopQuote: normalize(values.competitorLandmineTopQuote),
    voiceCadenceConstraint: normalize(values.voiceCadenceConstraint),
  };
}

function stripGuaranteesFromProductIntelInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...input };
  delete cleaned.guarantees;

  const citations = asObject(cleaned.citations);
  if (citations) {
    const nextCitations = { ...citations };
    delete (nextCitations as Record<string, unknown>).guarantees;
    cleaned.citations = nextCitations;
  }

  const validatedFields = asObject(cleaned.validated_fields);
  if (validatedFields) {
    const nextValidated = { ...validatedFields };
    delete (nextValidated as Record<string, unknown>).guarantees;
    cleaned.validated_fields = nextValidated;
  }

  if (Array.isArray(cleaned.resolved_via_web_search)) {
    cleaned.resolved_via_web_search = cleaned.resolved_via_web_search.filter(
      (field) => field !== "guarantees"
    );
  }

  return cleaned;
}

function toPatternEntry(value: unknown, category: string): Pattern | null {
  const input = asObject(value);
  if (!input) return null;
  const patternName =
    asString(input.pattern_name) ||
    asString(input.pattern) ||
    asString(input.name) ||
    asString(input.title) ||
    null;
  if (!patternName) return null;
  return {
    pattern_name: patternName,
    category,
    description: asString(input.description) || asString(input.reason) || undefined,
    example: asString(input.example) || undefined,
    timing: asString(input.timing) || undefined,
    visual_notes: asString(input.visual_notes) || asString(input.visual) || undefined,
    occurrence_rate:
      typeof input.occurrence_rate === "number" || typeof input.occurrence_rate === "string"
        ? input.occurrence_rate
        : undefined,
  };
}

function normalizePatternInputs(rawJson: unknown): {
  patterns: Pattern[];
  antiPatterns: AntiPattern[];
  stackingRules: StackingRule[];
} {
  const raw = asObject(rawJson) ?? {};
  const topLevelPatterns = raw.patterns;

  if (Array.isArray(topLevelPatterns)) {
    return {
      patterns: topLevelPatterns as Pattern[],
      antiPatterns: (Array.isArray(raw.anti_patterns) ? raw.anti_patterns : []) as AntiPattern[],
      stackingRules: (Array.isArray(raw.stacking_rules) ? raw.stacking_rules : []) as StackingRule[],
    };
  }

  const nested = asObject(topLevelPatterns) ?? {};
  const hookPatterns = Array.isArray(nested.hookPatterns) ? nested.hookPatterns : [];
  const messagePatterns = Array.isArray(nested.messagePatterns) ? nested.messagePatterns : [];
  const textOverlayPatterns = Array.isArray(nested.textOverlayPatterns) ? nested.textOverlayPatterns : [];
  const ctaPatterns = Array.isArray(nested.ctaPatterns) ? nested.ctaPatterns : [];
  const timingPatterns = Array.isArray(nested.timingPatterns) ? nested.timingPatterns : [];
  const avoidPatterns = Array.isArray(nested.avoidPatterns) ? nested.avoidPatterns : [];

  const patterns: Pattern[] = [
    ...hookPatterns
      .map((entry) => toPatternEntry(entry, "Hook Structure"))
      .filter((entry): entry is Pattern => Boolean(entry)),
    ...messagePatterns
      .map((entry) => toPatternEntry(entry, "Proof Mechanism"))
      .filter((entry): entry is Pattern => Boolean(entry)),
    ...textOverlayPatterns
      .map((entry) => toPatternEntry(entry, "Proof Mechanism"))
      .filter((entry): entry is Pattern => Boolean(entry)),
    ...ctaPatterns
      .map((entry) => toPatternEntry(entry, "Proof Mechanism"))
      .filter((entry): entry is Pattern => Boolean(entry)),
    ...timingPatterns
      .map((entry) => toPatternEntry(entry, "Proof Mechanism"))
      .filter((entry): entry is Pattern => Boolean(entry)),
  ];

  const antiPatterns: AntiPattern[] = avoidPatterns
    .map((entry) => {
      const input = asObject(entry);
      if (!input) return null;
      const patternName =
        asString(input.pattern_name) ||
        asString(input.pattern) ||
        asString(input.name) ||
        asString(input.title);
      if (!patternName) return null;
      return {
        pattern_name: patternName,
        why_it_fails:
          asString(input.why_it_fails) || asString(input.reason) || asString(input.description) || undefined,
        example: asString(input.example) || undefined,
      } as AntiPattern;
    })
    .filter((entry): entry is AntiPattern => Boolean(entry));

  return {
    patterns,
    antiPatterns,
    stackingRules: [],
  };
}

const DEFAULT_SCRIPT_TARGET_DURATION = 30;
const DEFAULT_SCRIPT_BEAT_COUNT = 5;

function normalizeTargetDurationValue(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_SCRIPT_TARGET_DURATION;
  if (rounded < 1 || rounded > 180) return DEFAULT_SCRIPT_TARGET_DURATION;
  return rounded;
}

function normalizeBeatCountValue(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_SCRIPT_BEAT_COUNT;
  if (rounded < 1 || rounded > 10) return DEFAULT_SCRIPT_BEAT_COUNT;
  return rounded;
}

function normalizeBeatRatios(value: unknown): BeatRatio[] {
  if (!Array.isArray(value)) return [];
  const normalized: BeatRatio[] = [];
  for (const entry of value) {
    const item = asObject(entry);
    if (!item) continue;
    const label = asString(item.label);
    const startPct = asNumber(item.startPct);
    const endPct = asNumber(item.endPct);
    if (!label || startPct === null || endPct === null) continue;
    if (startPct < 0 || endPct > 1 || startPct >= endPct) continue;
    normalized.push({ label, startPct, endPct });
  }
  return normalized;
}

function toJsonBeatRatios(ratios: BeatRatio[]): Array<{ label: string; startPct: number; endPct: number }> {
  return ratios.map((ratio) => ({
    label: ratio.label,
    startPct: ratio.startPct,
    endPct: ratio.endPct,
  }));
}

function formatSecondsForPrompt(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function buildDefaultBeatLabels(beatCount: number): string[] {
  if (beatCount <= 1) return ["Hook"];
  if (beatCount === 2) return ["Hook", "Payoff"];

  const middleLabelPool = [
    "Personal Context",
    "Problem Agitation",
    "Product as Solution",
    "Proof",
    "CTA Bridge",
    "Close",
  ];

  const labels = ["Hook"];
  for (let i = 0; i < beatCount - 2; i++) {
    labels.push(middleLabelPool[i] ?? `Beat ${i + 2}`);
  }
  labels.push("Payoff");
  return labels;
}

function buildDefaultBeatPlan(targetDuration: number, beatCount: number): BeatPlanEntry[] {
  const safeDuration = normalizeTargetDurationValue(targetDuration);
  const safeBeatCount = normalizeBeatCountValue(beatCount);
  const labels = buildDefaultBeatLabels(safeBeatCount);
  const secondsPerBeat = safeDuration / safeBeatCount;
  let start = 0;

  return labels.map((label, index) => {
    const end = index === safeBeatCount - 1 ? safeDuration : start + secondsPerBeat;
    const entry: BeatPlanEntry = {
      label,
      duration: `${formatSecondsForPrompt(start)}-${formatSecondsForPrompt(end)}s`,
    };
    start = end;
    return entry;
  });
}

function parsePrescriptiveBodySegments(body: string): string[] {
  const normalized = body
    .split(/\r?\n|;/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalized.length !== 1) return normalized;
  return normalized[0]
    .split(/\s*\|\s*|,\s*(?=\d)|,\s*(?=[A-Za-z]+\s*\d)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeTimingDuration(value: Record<string, unknown>, fallback: string): string {
  return (
    asString(value.timing) ||
    asString(value.time_range) ||
    asString(value.window) ||
    asString(value.duration) ||
    fallback
  );
}

function normalizeTimingLabel(value: Record<string, unknown>, fallback: string): string {
  return (
    asString(value.beat) ||
    asString(value.phase) ||
    asString(value.pattern_name) ||
    asString(value.pattern) ||
    asString(value.title) ||
    fallback
  );
}

function normalizeTimingGuidance(value: Record<string, unknown>): string | undefined {
  return (
    asString(value.description) ||
    asString(value.reason) ||
    asString(value.example) ||
    asString(value.visual_notes) ||
    undefined
  );
}

function buildBeatPlanFromPatternData(
  rawPatternJson: unknown,
  targetDuration: number,
  beatCount: number,
): {
  beats: BeatPlanEntry[];
  source: "timingPatterns" | "prescriptiveGuidance.body" | "default";
} {
  const fallbackBeats = buildDefaultBeatPlan(targetDuration, beatCount);
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const timingPatternsRaw = Array.isArray(patternsRoot?.timingPatterns)
    ? patternsRoot?.timingPatterns
    : [];
  const timingPatterns = timingPatternsRaw
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  if (timingPatterns.length > 0) {
    const mapped: BeatPlanEntry[] = timingPatterns
      .slice(0, fallbackBeats.length)
      .map((entry, index) => {
        const fallback = fallbackBeats[index] ?? fallbackBeats[fallbackBeats.length - 1];
        const guidance = normalizeTimingGuidance(entry);
        return {
          label: normalizeTimingLabel(entry, fallback.label),
          duration: normalizeTimingDuration(entry, fallback.duration),
          ...(guidance ? { guidance } : {}),
        };
      });

    while (mapped.length < fallbackBeats.length) {
      mapped.push({ ...fallbackBeats[mapped.length] });
    }

    return { beats: mapped, source: "timingPatterns" };
  }

  const prescriptiveGuidance = asObject(patternsRoot?.prescriptiveGuidance);
  const bodyGuidance = asString(prescriptiveGuidance?.body);
  if (bodyGuidance) {
    const segments = parsePrescriptiveBodySegments(bodyGuidance);
    const mapped = fallbackBeats.map((beat, index) => ({
      ...beat,
      guidance: segments[index] || segments[0] || undefined,
    }));
    return { beats: mapped, source: "prescriptiveGuidance.body" };
  }

  return { beats: fallbackBeats, source: "default" };
}

function extractTransferFormula(rawPatternJson: unknown): string | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);
  if (!prescriptiveGuidance) return null;

  const transferRaw =
    prescriptiveGuidance?.transferFormula ??
    prescriptiveGuidance?.transfer_formula;

  const legacy = asString(transferRaw);
  if (legacy) return legacy;

  const transferObj = asObject(transferRaw);
  if (!transferObj) return null;

  const label = asString(transferObj.label);
  const components = Array.isArray(transferObj.components) ? transferObj.components : [];
  const componentLines = components
    .map((entry) => {
      const component = asObject(entry);
      if (!component) return null;
      const name = asString(component.name);
      const executionBrief =
        asString(component.executionBrief) ||
        asString(component.execution_brief);
      if (!name || !executionBrief) return null;
      return `  - ${name}: ${executionBrief}`;
    })
    .filter((line): line is string => Boolean(line));

  if (!label && componentLines.length === 0) return null;
  if (componentLines.length === 0) return label;
  if (!label) return `Components:\n${componentLines.join("\n")}`;
  return `${label}\nComponents:\n${componentLines.join("\n")}`;
}

function extractPsychologicalMechanism(rawPatternJson: unknown): string | null {
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);
  if (!prescriptiveGuidance) return null;

  const mechanismRaw =
    prescriptiveGuidance?.psychologicalMechanism ??
    prescriptiveGuidance?.psychological_mechanism;

  const legacy = asString(mechanismRaw);
  if (legacy) return legacy;

  const mechanismObj = asObject(mechanismRaw);
  if (!mechanismObj) return null;

  const label = asString(mechanismObj.label);
  const executionBrief =
    asString(mechanismObj.executionBrief) ||
    asString(mechanismObj.execution_brief);

  if (!label && !executionBrief) return null;
  if (!executionBrief) return label;
  if (!label) return `How to execute: ${executionBrief}`;
  return `${label}\nHow to execute: ${executionBrief}`;
}

function buildVoiceCadenceConstraint(rawPatternJson: unknown): string {
  const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const root = asObject(rawPatternJson);
  const patternsRoot = asObject(root?.patterns);
  const prescriptiveGuidance =
    asObject(patternsRoot?.prescriptiveGuidance) ||
    asObject(root?.prescriptiveGuidance);

  const voiceCadenceRaw = prescriptiveGuidance?.voiceCadence;
  const directString = asString(voiceCadenceRaw);
  if (directString) {
    return directString;
  }

  const voiceCadence = asObject(voiceCadenceRaw);
  if (!voiceCadence) {
    return "MISSING";
  }

  const avgSentenceLength = toFiniteNumber(voiceCadence.averageSentenceLength);
  const sentenceLengthVariance = toFiniteNumber(voiceCadence.sentenceLengthVariance);
  const questionUsageFrequency = toFiniteNumber(voiceCadence.questionUsageFrequency);
  const pauseIndicators = asObject(voiceCadence.pauseIndicators);
  const openingSentenceStructure = asObject(voiceCadence.openingSentenceStructure);
  const dominantOpening = asString(openingSentenceStructure?.dominant);
  const openingExamples = asStringArray(openingSentenceStructure?.examples).slice(0, 3);
  const openingDistributionObj = asObject(openingSentenceStructure?.distribution);
  const openingDistribution = openingDistributionObj
    ? Object.entries(openingDistributionObj)
        .map(([key, value]) => {
          const count = toFiniteNumber(value);
          return count !== null ? `${key}: ${count}` : null;
        })
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const lines = [
    avgSentenceLength !== null
      ? `Average sentence length: ${avgSentenceLength.toFixed(2)} words`
      : null,
    sentenceLengthVariance !== null
      ? `Sentence length variance: ${sentenceLengthVariance.toFixed(2)}`
      : null,
    pauseIndicators
      ? `Pause indicators: periods=${toFiniteNumber(pauseIndicators.periods) ?? 0}, dashes=${toFiniteNumber(pauseIndicators.dashes) ?? 0}, ellipses=${toFiniteNumber(pauseIndicators.ellipses) ?? 0}`
      : null,
    questionUsageFrequency !== null
      ? `Question usage frequency: ${(questionUsageFrequency * 100).toFixed(1)}% of sentences`
      : null,
    dominantOpening ? `Opening sentence structure (dominant): ${dominantOpening}` : null,
    openingDistribution.length > 0
      ? `Opening sentence structure distribution: ${openingDistribution.join(", ")}`
      : null,
    openingExamples.length > 0
      ? `Opening sentence examples: ${openingExamples.map((example) => `"${example}"`).join(" | ")}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : "MISSING";
}

function assignFormulaComponentsToBeats(
  beats: BeatPlanEntry[],
  transferFormula: string | null | undefined,
): BeatPlanEntry[] {
  const normalizedFormula = asString(transferFormula);
  if (!normalizedFormula) {
    return beats;
  }

  const formulaComponents = normalizedFormula
    .split(" + ")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
  if (!formulaComponents.length || beats.length === 0) {
    return beats;
  }

  const mappedBeats = beats.map((beat) => ({ ...beat }));
  const beatTotal = mappedBeats.length;
  const componentTotal = formulaComponents.length;

  if (beatTotal === 1) {
    mappedBeats[0].formulaComponent = formulaComponents.join(" + ");
    return mappedBeats;
  }

  if (componentTotal === 1) {
    for (const beat of mappedBeats) {
      beat.formulaComponent = formulaComponents[0];
    }
    return mappedBeats;
  }

  mappedBeats[0].formulaComponent = formulaComponents[0];
  mappedBeats[beatTotal - 1].formulaComponent = formulaComponents[componentTotal - 1];

  const middleBeatTotal = Math.max(0, beatTotal - 2);
  if (middleBeatTotal === 0) {
    return mappedBeats;
  }

  const middleComponents = formulaComponents.slice(1, -1);
  if (middleComponents.length === 0) {
    for (let beatIndex = 1; beatIndex < beatTotal - 1; beatIndex += 1) {
      mappedBeats[beatIndex].formulaComponent = formulaComponents[0];
    }
    return mappedBeats;
  }

  if (componentTotal > beatTotal) {
    let cursor = 0;
    for (let beatIndex = 1; beatIndex < beatTotal - 1; beatIndex += 1) {
      const remainingComponents = middleComponents.length - cursor;
      const remainingMiddleBeats = beatTotal - beatIndex - 1;
      if (remainingComponents <= 0) {
        mappedBeats[beatIndex].formulaComponent = middleComponents[middleComponents.length - 1];
        continue;
      }
      const absorbCount = Math.ceil(remainingComponents / remainingMiddleBeats);
      const absorbed = middleComponents.slice(cursor, cursor + absorbCount);
      mappedBeats[beatIndex].formulaComponent = absorbed.join(" + ");
      cursor += absorbCount;
    }
    return mappedBeats;
  }

  for (let beatIndex = 1; beatIndex < beatTotal - 1; beatIndex += 1) {
    const middlePosition = beatIndex - 1;
    const mappedComponentIndex = Math.floor(
      (middlePosition * middleComponents.length) / middleBeatTotal,
    );
    const sourceIndex = Math.min(
      middleComponents.length - 1,
      Math.max(0, mappedComponentIndex),
    );
    mappedBeats[beatIndex].formulaComponent = middleComponents[sourceIndex];
  }

  return mappedBeats;
}

async function loadStructuredProductIntel(projectId: string): Promise<StructuredProductIntelRow | null> {
  try {
    const rows = await prisma.$queryRaw<StructuredProductIntelRow[]>`
      SELECT
        "id",
        "projectId",
        "jobId",
        "url",
        "productName",
        "tagline",
        "keyFeatures",
        "ingredientsOrSpecs",
        "price",
        "keyClaims",
        "targetAudience",
        "usp",
        "rawHtml",
        "createdAt"
      FROM "product_intel"
      WHERE "projectId" = ${projectId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    const message = String((error as any)?.message ?? "");
    if (
      message.includes('relation "product_intel" does not exist') ||
      (message.includes('column "') && message.includes('" does not exist'))
    ) {
      return null;
    }
    throw error;
  }
}

async function loadStructuredProductIntelByJobId(jobId: string): Promise<StructuredProductIntelRow | null> {
  try {
    const rows = await prisma.$queryRaw<StructuredProductIntelRow[]>`
      SELECT
        "id",
        "projectId",
        "jobId",
        "url",
        "productName",
        "tagline",
        "keyFeatures",
        "ingredientsOrSpecs",
        "price",
        "keyClaims",
        "targetAudience",
        "usp",
        "rawHtml",
        "createdAt"
      FROM "product_intel"
      WHERE "jobId" = ${jobId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    const message = String((error as any)?.message ?? "");
    if (
      message.includes('relation "product_intel" does not exist') ||
      (message.includes('column "') && message.includes('" does not exist'))
    ) {
      return null;
    }
    throw error;
  }
}

async function selectProductCollectionJob(
  projectId: string,
  preferredRunId: string | null
): Promise<ProductCollectionJobContext | null> {
  if (preferredRunId) {
    const sameRun = await prisma.job.findFirst({
      where: {
        projectId,
        type: JobType.PRODUCT_DATA_COLLECTION,
        status: JobStatus.COMPLETED,
        runId: preferredRunId,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        runId: true,
        createdAt: true,
        updatedAt: true,
        payload: true,
      },
    });
    if (sameRun) return sameRun;
  }

  return prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.PRODUCT_DATA_COLLECTION,
      status: JobStatus.COMPLETED,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      runId: true,
      createdAt: true,
      updatedAt: true,
      payload: true,
    },
  });
}

function mapProductCollectionIntelToPrompt(
  intel: Record<string, unknown>,
  fallbackProductName: string,
  sourceUrl: string | null
): Record<string, unknown> {
  const keyFeatures = asStringArray(intel.key_features ?? intel.keyFeatures);
  const keyClaims = asStringArray(intel.specific_claims ?? intel.keyClaims);
  const ingredientsOrSpecs = asStringArray(
    intel.ingredients_or_specs ?? intel.ingredientsOrSpecs
  );
  const mainBenefit = asString(intel.main_benefit ?? intel.mainBenefit);
  const usage = asString(intel.usage);
  const format = asString(intel.format);
  const mechanismProcess = [usage, format, mainBenefit].filter(Boolean).join("; ");

  return {
    productName:
      asString(intel.product_name) ||
      asString(intel.productName) ||
      fallbackProductName,
    url: sourceUrl,
    tagline: asString(intel.tagline),
    ingredientsOrSpecs,
    usp: mainBenefit,
    keyFeatures,
    keyClaims,
    targetAudience: asString(intel.target_audience ?? intel.targetAudience),
    price: asString(intel.price),
    rawHtml: asString(intel.raw_html ?? intel.rawHtml),
    mechanism: mechanismProcess ? [{ process: mechanismProcess }] : undefined,
  };
}

async function loadProductIntelFromCollectionJob(
  projectId: string,
  job: ProductCollectionJobContext,
  fallbackProductName: string
): Promise<Record<string, unknown> | null> {
  const payload = asObject(job.payload);
  const payloadResult = asObject(payload?.result);
  const payloadIntel = asObject(payloadResult?.intel);
  const payloadProductUrl = asString(payload?.productUrl);

  if (payloadIntel) {
    return mapProductCollectionIntelToPrompt(
      payloadIntel,
      fallbackProductName,
      payloadProductUrl
    );
  }

  const researchIntelRow = await prisma.researchRow.findFirst({
    where: {
      projectId,
      jobId: job.id,
      type: "product_intel",
    },
    orderBy: { createdAt: "desc" },
    select: {
      content: true,
      metadata: true,
    },
  });

  if (researchIntelRow?.content) {
    try {
      const parsed = JSON.parse(researchIntelRow.content);
      const intel = asObject(parsed);
      if (intel) {
        const metadata = asObject(researchIntelRow.metadata);
        const metadataUrl = asString(metadata?.url) || asString(metadata?.source_url);
        return mapProductCollectionIntelToPrompt(
          intel,
          fallbackProductName,
          metadataUrl || payloadProductUrl
        );
      }
    } catch {
      // ignore invalid JSON and continue fallbacks
    }
  }

  const structuredByJob = await loadStructuredProductIntelByJobId(job.id);
  if (structuredByJob) {
    return {
      productName: structuredByJob.productName || fallbackProductName,
      url: structuredByJob.url,
      tagline: structuredByJob.tagline,
      ingredientsOrSpecs: structuredByJob.ingredientsOrSpecs,
      usp: structuredByJob.usp,
      keyFeatures: structuredByJob.keyFeatures,
      keyClaims: structuredByJob.keyClaims,
      targetAudience: structuredByJob.targetAudience,
      price: structuredByJob.price,
      rawHtml: structuredByJob.rawHtml,
    };
  }

  return null;
}

async function callAnthropic(system: string, prompt: string): Promise<string> {
  const model = cfg.raw('ANTHROPIC_MODEL') || 'claude-sonnet-4-5-20250929';
  requireEnv(['ANTHROPIC_API_KEY'], 'ANTHROPIC');
  const apiKey = env('ANTHROPIC_API_KEY')!;
  const anthropic = new Anthropic({
    apiKey,
    timeout: 60000,
  });
  console.log("Anthropic client timeout:", 60000);

  const isRetryable = (err: any) => {
    const msg = String(err?.message ?? err).toLowerCase();
    return (
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('5')
    );
  };

  console.log("[LLM] about to call guardedExternalCall");
  return guardedExternalCall({
    breakerKey: 'anthropic:messages.create',
    breaker: { failureThreshold: LLM_BREAKER_FAILS, cooldownMs: LLM_BREAKER_COOLDOWN_MS },
    timeoutMs: LLM_TIMEOUT_MS,
    retry: { retries: LLM_RETRIES, baseDelayMs: 500, maxDelayMs: 5000 },
    label: 'Anthropic messages.create',
    isRetryable,
    fn: async () => {
      console.log("[LLM] inside guarded fn");
      if (flag("FF_SIMULATE_LLM_FAIL")) {
        throw new Error("Simulated LLM 500");
      }

      if (flag("FF_SIMULATE_LLM_HANG")) {
        await new Promise(() => {}); // simulate hang for timeout testing
      }

      const data = await anthropic.messages.create({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = Array.isArray(data?.content)
        ? data.content
            .filter((block) => block?.type === "text")
            .map((block) => String((block as any).text ?? ""))
            .join("\n")
            .trim()
        : "";
      return textContent || String((data as any)?.content ?? "");
    },
  });
}

function parseJsonFromLLM(text: string): ScriptJSON {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenceMatch ? fenceMatch[1] : text;

  const start = raw.indexOf('{');
  if (start === -1) {
    throw new Error('No "{" found in LLM response');
  }

  let braceCount = 0;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') braceCount++;
    if (raw[i] === '}') braceCount--;
    if (braceCount === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new Error('Unclosed JSON object in LLM response');
  }

  const jsonStr = raw.substring(start, end + 1).trim();
  return JSON.parse(jsonStr) as ScriptJSON;
}

function buildVoFullFromScriptJson(scriptJson: ScriptJSON): string {
  const directVo = asString(scriptJson?.vo_full);
  if (directVo) return directVo;
  if (!Array.isArray(scriptJson?.scenes)) return "";
  return scriptJson.scenes
    .map((scene) => {
      const sceneObj = asObject(scene) ?? {};
      return asString(sceneObj.vo) ?? "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

type NumericExtractionOptions = {
  excludeTimingReferences?: boolean;
  excludeSingleDigit?: boolean;
};

function isTimingAdjacent(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 16), start).toLowerCase();
  const after = text.slice(end, Math.min(text.length, end + 16)).toLowerCase();

  if (/^\s*-?\s*(?:s|sec|secs|second|seconds)\b/.test(after)) {
    return true;
  }
  if (/(?:\b|\s)(?:s|sec|secs|second|seconds)\s*-?\s*$/.test(before)) {
    return true;
  }

  return false;
}

function extractNumericTokens(value: string, options: NumericExtractionOptions = {}): string[] {
  const { excludeTimingReferences = false, excludeSingleDigit = false } = options;
  const tokens: string[] = [];
  const regex = /\d+(?:\.\d+)?%?/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(value)) !== null) {
    const token = String(match[0] ?? "");
    if (!token) continue;

    const start = match.index;
    const end = start + token.length;
    const isPercent = token.endsWith("%");
    const numericPart = isPercent ? token.slice(0, -1) : token;
    const parsed = Number(numericPart);

    if (excludeTimingReferences && isTimingAdjacent(value, start, end)) {
      continue;
    }

    if (
      excludeSingleDigit &&
      !isPercent &&
      Number.isFinite(parsed) &&
      Math.abs(parsed) < 10
    ) {
      continue;
    }

    tokens.push(token);
  }

  return tokens;
}

function normalizeNumericToken(value: string): string {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const isPercent = trimmed.endsWith("%");
  const numericPart = isPercent ? trimmed.slice(0, -1) : trimmed;
  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) {
    return trimmed.toLowerCase();
  }
  const normalizedNumber = String(parsed);
  return isPercent ? `${normalizedNumber}%` : normalizedNumber;
}

function tokenizeSemanticKeywords(input: string): string[] {
  const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "for", "of", "to", "in", "on", "at", "with", "from",
    "by", "is", "are", "was", "were", "be", "been", "this", "that", "these", "those", "it",
    "its", "as", "if", "so", "than", "then", "you", "your", "yours", "we", "our", "ours", "i",
    "me", "my", "mine", "they", "their", "theirs", "he", "she", "his", "her", "him", "them",
  ]);

  const tokens = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
}

function countWords(value: string): number {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/).length;
}

export function validateScriptAgainstGates(args: {
  scriptJson: ScriptJSON;
  copyReadyPhrases: string[];
  verifiedNumericClaims: string[];
  successLooksLikeQuote: string;
}): ScriptValidationReport {
  const voFull = buildVoFullFromScriptJson(args.scriptJson);
  const voLower = voFull.toLowerCase();
  const scenes = Array.isArray(args.scriptJson?.scenes) ? args.scriptJson.scenes : [];
  const finalScene = scenes.length > 0 ? asObject(scenes[scenes.length - 1]) : null;
  const finalBeatVo = asString(finalScene?.vo) ?? "";

  const normalizedCopyReadyPhrases = Array.from(
    new Set(
      (args.copyReadyPhrases ?? [])
        .map((phrase) => asString(phrase) ?? "")
        .filter(Boolean),
    ),
  );
  const matchedPhrases = normalizedCopyReadyPhrases.filter((phrase) =>
    voLower.includes(phrase.toLowerCase()),
  );
  const gate1Passed = matchedPhrases.length >= 2;

  const verifiedNumberSet = new Set(
    (args.verifiedNumericClaims ?? [])
      .flatMap((claim) => extractNumericTokens(claim))
      .map((token) => normalizeNumericToken(token))
      .filter(Boolean),
  );
  const extractedNumbers = extractNumericTokens(voFull, {
    excludeTimingReferences: true,
    excludeSingleDigit: true,
  }).map((token) => normalizeNumericToken(token));
  const unmatchedNumbers = Array.from(
    new Set(
      extractedNumbers.filter((token) => token && !verifiedNumberSet.has(token)),
    ),
  );
  const gate2Passed = unmatchedNumbers.length === 0;

  const successKeywords = tokenizeSemanticKeywords(args.successLooksLikeQuote ?? "");
  const finalBeatKeywords = new Set(tokenizeSemanticKeywords(finalBeatVo));
  const overlapKeywords = successKeywords.filter((token) => finalBeatKeywords.has(token));
  const gate3Passed = successKeywords.length === 0 ? true : overlapKeywords.length > 0;

  const warnings: string[] = [];
  if (!gate1Passed) {
    warnings.push(
      `Copy-ready language gate failed: matched ${matchedPhrases.length}/2 required phrases in vo_full.`,
    );
  }
  if (!gate2Passed) {
    warnings.push(
      `Verified numeric claims gate failed: unverified numbers found (${unmatchedNumbers.join(", ")}).`,
    );
  }
  if (!gate3Passed) {
    warnings.push("Final beat outcome gate failed: final beat does not overlap success outcome language.");
  }

  const passedCount = [gate1Passed, gate2Passed, gate3Passed].filter(Boolean).length;
  const qualityScore = Math.max(0, Math.min(100, Math.round((passedCount / 3) * 100)));

  return {
    gatesPassed: warnings.length === 0,
    warnings,
    qualityScore,
    gateResults: {
      copyReadyPhrases: {
        passed: gate1Passed,
        required: 2,
        matchedCount: matchedPhrases.length,
        matchedPhrases,
      },
      verifiedNumericClaims: {
        passed: gate2Passed,
        extractedNumbers,
        unmatchedNumbers,
      },
      finalBeatOutcomeOverlap: {
        passed: gate3Passed,
        overlapKeywords,
        matchedKeywordCount: overlapKeywords.length,
      },
    },
  };
}

/**
 * Build script prompt from avatar, product intel, and pattern brain.
 */
function buildScriptPrompt(args: {
  productName: string;
  avatar: any;
  productIntel: any;
  patternRawJson: unknown;
  swipeFile: SwipeFileSelection | null;
  targetDuration: number;
  beatCount: number;
  beatRatios?: BeatRatio[];
  patterns: Pattern[];
  antiPatterns: AntiPattern[];
  stackingRules: StackingRule[];
}): {
  system: string;
  prompt: string;
  promptInjections: PromptInjectionValues;
  validationInputs: ScriptValidationInputs;
} {
  const {
    productName,
    avatar,
    productIntel,
    patternRawJson,
    swipeFile,
    targetDuration,
    beatCount,
    beatRatios,
    patterns,
    antiPatterns,
    stackingRules,
  } = args;

  const hookCandidates = patterns.filter(
    p => p.category === 'Hook Structure' && String(p.occurrence_rate) === 'high',
  );
  const hookPattern =
    hookCandidates[0] ||
    patterns.find(p => p.category === 'Hook Structure') ||
    patterns[0];

  const proofCandidates = patterns.filter(p => p.category === 'Proof Mechanism');
  const amplifyRule = stackingRules.find(
    r =>
      r.synergy_type === 'amplify' &&
      Array.isArray(r.combination) &&
      hookPattern &&
      r.combination.includes(hookPattern.pattern_name),
  );
  const proofPattern =
    (amplifyRule &&
      proofCandidates.find(p =>
        amplifyRule.combination.includes(p.pattern_name),
      )) ||
    proofCandidates.find(p => String(p.occurrence_rate) === 'high') ||
    proofCandidates[0] ||
    patterns[0];

  const conflictRule = stackingRules.find(
    r =>
      r.synergy_type === 'conflict' &&
      r.combination?.includes(hookPattern?.pattern_name) &&
      r.combination?.includes(proofPattern?.pattern_name),
  );

  if (conflictRule) {
    throw new Error(
      `Pattern conflict: ${hookPattern?.pattern_name} + ${proofPattern?.pattern_name} → ${conflictRule.performance_delta}`,
    );
  }

  const highFailAnti = antiPatterns
    .filter(ap => (ap.non_converter_rate ?? 0) > 0.5)
    .map(ap => `${ap.pattern_name}: ${ap.why_it_fails}`)
    .join('\n');

  const avatarSnap = avatar?.avatar_snapshot ?? {};
  const psycho =
    typeof avatar.psychographics === 'string'
      ? avatar.psychographics
      : JSON.stringify(avatar.psychographics ?? {});

  const goalNow = Array.isArray(avatar.goals?.now) ? avatar.goals.now[0] : null;
  const goalFuture = Array.isArray(avatar.goals?.future)
    ? avatar.goals.future[0]
    : null;
  const goal = goalNow || goalFuture || 'solve the core problem';

  const firstBlocker = Array.isArray(avatar.purchase_blockers)
    ? avatar.purchase_blockers[0]
    : undefined;

  const blockerFear = firstBlocker?.fear || 'wasting money';
  const blockerQuote = firstBlocker?.quote || '';

  const mechanismProcess =
    productIntel?.mechanism?.[0]?.process ||
    productIntel?.usp ||
    productIntel?.tagline ||
    (Array.isArray(productIntel?.keyClaims) ? productIntel.keyClaims[0] : undefined) ||
    'addresses root cause';
  const numericClaimCandidates = [
    ...asStringArray(productIntel?.keyClaims),
    ...asStringArray(productIntel?.keyFeatures),
    asString(productIntel?.usp),
    asString(productIntel?.tagline),
  ].filter((entry): entry is string => Boolean(entry));
  const verifiedNumericClaims = Array.from(
    new Set(numericClaimCandidates.filter((claim) => /\d/.test(claim)))
  );

  const avatarAge = avatarSnap.age ?? 30;
  const avatarGender = avatarSnap.gender || 'person';
  const avatarJob = avatarSnap.job || 'working professional';
  const psychographics = psycho || 'cares about quality and results';
  const hookPatternName = hookPattern?.pattern_name || 'Unknown';
  const hookPatternExample = hookPattern?.example || '';
  const proofPatternName = proofPattern?.pattern_name || 'Unknown';
  const proofPatternDescription = proofPattern?.description || '';
  const amplifySynergy = amplifyRule?.performance_delta || 'neutral';
  const avatarRoot = asObject(avatar) ?? {};
  const avatarSection = asObject(avatarRoot.avatar) ?? {};
  const avatarProfile = asObject(avatarSection.profile) ?? asObject(avatarRoot.profile);
  const competitiveAnalysis = asObject(avatarRoot.competitive_analysis) ?? asObject(avatarSection.competitive_analysis);
  const copyReadyPhrases = Array.from(
    new Set([
      ...asStringArray(avatarRoot.copy_ready_phrases),
      ...asStringArray(avatarSection.copy_ready_phrases),
      ...asStringArray(avatarRoot.voc_phrases),
      ...asStringArray(avatarSection.voc_phrases),
    ])
  );
  const successLooksLike = asObject(avatarRoot.success_looks_like) ?? asObject(avatarSection.success_looks_like);
  const buyTrigger = asObject(avatarRoot.buy_trigger) ?? asObject(avatarSection.buy_trigger);
  const competitorLandminesRaw = Array.isArray(avatarRoot.competitor_landmines)
    ? avatarRoot.competitor_landmines
    : Array.isArray(avatarSection.competitor_landmines)
      ? avatarSection.competitor_landmines
      : [];
  const topCompetitorLandmine = asObject(competitorLandminesRaw[0]);
  const competitorWeaknesses = Array.isArray(competitiveAnalysis?.competitor_weaknesses)
    ? competitiveAnalysis.competitor_weaknesses
    : [];
  const topCompetitorWeakness = asObject(competitorWeaknesses[0]);
  const successCriteria = asObject(avatarSection.success_criteria);
  const successLooksLikeQuote =
    asString(successLooksLike?.quote) ||
    asString(successLooksLike?.emotional_payoff) ||
    asString(successLooksLike?.outcome) ||
    firstStringInArray(successCriteria?.supporting_quotes) ||
    '';
  const buyTriggerQuote =
    asString(buyTrigger?.quote) ||
    firstStringInArray(buyTrigger?.supporting_quotes) ||
    asString(buyTrigger?.trigger) ||
    asString(buyTrigger?.situation) ||
    '';
  const buyTriggerSituation =
    asString(buyTrigger?.situation) ||
    asString(buyTrigger?.trigger) ||
    '';
  const lifeStage =
    asString(avatarSection.life_stage) ||
    asString(avatarProfile?.life_stage) ||
    asString(avatarRoot.life_stage) ||
    '';
  const urgencyLevel =
    asString(avatarSection.urgency_level) ||
    asString(avatarProfile?.decision_urgency) ||
    asString(avatarProfile?.urgency_level) ||
    asString(avatarRoot.urgency_level) ||
    '';
  const competitorLandmineTopQuote =
    asString(topCompetitorLandmine?.quote) ||
    asString(topCompetitorLandmine?.impact) ||
    asString(topCompetitorLandmine?.what_failed) ||
    firstStringInArray(topCompetitorWeakness?.supporting_quotes) ||
    '';
  const copyReadyPhrasesList = copyReadyPhrases.length
    ? copyReadyPhrases.map((phrase, index) => `${index + 1}. "${phrase}"`).join("\n")
    : "MISSING";
  const beatPlanBase = buildBeatPlanFromPatternData(
    patternRawJson,
    targetDuration,
    beatCount,
  );
  const transferFormula = extractTransferFormula(patternRawJson);
  const beatPlan = {
    ...beatPlanBase,
    beats: assignFormulaComponentsToBeats(beatPlanBase.beats, transferFormula),
  };
  const psychologicalMechanism = extractPsychologicalMechanism(patternRawJson) || "MISSING";
  const voiceCadenceConstraint = buildVoiceCadenceConstraint(patternRawJson);
  const schemaTimingPlan = buildDefaultBeatPlan(targetDuration, beatCount);
  const dynamicWordCeiling = Math.round((targetDuration / 60) * 135 * 0.9);
  const beatStructureLines = beatPlan.beats
    .map((beat, index) => {
      return `- Beat ${index + 1}: ${beat.label} (${beat.duration})`;
    })
    .join("\n");
  const formulaComponentsPerBeatLines = beatPlan.beats
    .map((beat, index) => {
      const component = asString(beat.formulaComponent);
      return component ? `- Beat ${index + 1}: ${component}` : null;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const tier1FormulaSection = formulaComponentsPerBeatLines
    ? `formulaComponentsPerBeat:
${formulaComponentsPerBeatLines}`
    : "";
  const outputSceneSchema = schemaTimingPlan
    .map(
      (timedBeat, index) => {
        const beat = beatPlan.beats[index] ?? timedBeat;
        return `    {\n      "beat": "${escapePromptJsonString(beat.label)}",\n      "duration": "${escapePromptJsonString(timedBeat.duration)}",\n      "vo": "text"\n    }`;
      }
    )
    .join(",\n");
  const swipeMetadata = swipeFile?.swipeMetadata ?? null;
  const swipeFileViewsLabel =
    typeof swipeFile?.views === "number" ? swipeFile.views.toLocaleString() : "unknown";
  const swipeBeatStructure = swipeMetadata?.beatStructure?.length
    ? swipeMetadata.beatStructure
        .map((beat) => `- ${beat.beat} (${beat.duration}): ${beat.pattern}`)
        .join("\n")
    : "- Not provided";
  const swipeTemplateSection = swipeMetadata
    ? `SWIPE FILE TEMPLATE (from ${swipeFileViewsLabel} views)
Hook (0-3s): ${swipeMetadata.hookPattern}
Problem (3-8s): ${swipeMetadata.problemPattern}
Solution (8-13s): ${swipeMetadata.solutionPattern}
CTA (13-15s): ${swipeMetadata.ctaPattern}

Beat structure:
${swipeBeatStructure}

Apply this structure exactly, but fill it with this project's avatar language and product claims.
`
    : "";

  // Tiered prompt contract:
  // Tier 1 = hard architectural constraints, Tier 2 = pass/fail quality gates, Tier 3 = flexible guidance.
  const system = swipeMetadata
    ? "You are a TikTok conversion copywriter. Use the provided swipe template as the primary script structure while keeping all output constraints. Output ONLY valid JSON. No markdown. No preamble."
    : "You are a TikTok conversion copywriter. You write 30-second UGC scripts that stop scrolls and drive purchases. Every word earns its place. Output ONLY valid JSON. No markdown. No preamble.";

  const proportionalTiming = beatRatios && beatRatios.length > 0
    ? scaleBeatRatiosToduration(beatRatios, targetDuration)
    : null;
  const proportionalTimingSection = proportionalTiming
    ? `proportionalBeatTiming:\n${proportionalTiming}\n`
    : `beatCount: ${beatCount}\n`;

  const prompt = `${swipeTemplateSection}TIER 1 - STRUCTURE (NON-NEGOTIABLE)
targetDuration: ${targetDuration}
dynamicWordCeiling: ${dynamicWordCeiling}
${proportionalTimingSection}
beatStructureLines:
${beatStructureLines}
${tier1FormulaSection}
Break any Tier 1 rule and the output is unusable. These are architectural constraints.

TIER 2 - QUALITY GATES (GO/NO-GO)
copyReadyPhrases minimum: include at least 2 phrases verbatim or near-verbatim.
copyReadyPhrases list:
${copyReadyPhrasesList}
verifiedNumericClaims (use these or use no numbers):
${verifiedNumericClaims.length > 0 ? verifiedNumericClaims.map((claim, idx) => `${idx + 1}. ${claim}`).join('\n') : "None provided"}
finalBeatOutcome requirement:
"${successLooksLikeQuote || "MISSING"}"
Pass all three gates or the script fails review.

TIER 3 - GUIDANCE (INFORM DON'T DICTATE)
productName: ${productName}
mechanismProcess: ${mechanismProcess}
avatarDetails: ${avatarAge}yo ${avatarGender}, ${avatarJob}
buyTriggerSituation: "${buyTriggerSituation || "MISSING"}"
psychologicalMechanism: ${psychologicalMechanism}
hookPatternExample: "${hookPatternExample || "MISSING"}"
competitorLandmineTopQuote: "${competitorLandmineTopQuote || "MISSING"}"
voiceCadence:
${voiceCadenceConstraint}
Use Tier 3 to inform tone and style. Flex for creative flow when needed.

OUTPUT SCHEMA
{
  "scenes": [
${outputSceneSchema}
  ],
  "vo_full": "complete voiceover with scene markers",
  "word_count": number
}

Return ONLY JSON.`;

  return {
    system,
    prompt,
    promptInjections: {
      productName,
      mechanismProcess,
      avatarAge,
      avatarGender,
      avatarJob,
      psychographics,
      goal,
      blockerFear,
      blockerQuote,
      hookPatternName,
      hookPatternExample,
      proofPatternName,
      proofPatternDescription,
      amplifySynergy,
      copyReadyPhrases: copyReadyPhrases.join(" | "),
      successLooksLikeQuote,
      buyTriggerQuote,
      buyTriggerSituation,
      lifeStage,
      urgencyLevel,
      competitorLandmineTopQuote,
      voiceCadenceConstraint,
    },
    validationInputs: {
      copyReadyPhrases,
      verifiedNumericClaims,
      successLooksLikeQuote,
    },
  };
}

type ScriptJobPayload = {
  customerAnalysisJobId?: unknown;
  targetDuration?: unknown;
  beatCount?: unknown;
  beatRatios?: unknown;
  scriptStrategy?: unknown;
  swipeTemplateAdId?: unknown;
};

type ScriptGenerationJobConfig = {
  customerAnalysisJobId: string | null;
  targetDuration: number;
  beatCount: number;
  beatRatios: BeatRatio[];
  scriptStrategy: ScriptStrategy;
  swipeTemplateAdId: string | null;
};

async function getRequestedScriptGenerationConfig(jobId?: string): Promise<ScriptGenerationJobConfig> {
  if (!jobId) {
    return {
      customerAnalysisJobId: null,
      targetDuration: DEFAULT_SCRIPT_TARGET_DURATION,
      beatCount: DEFAULT_SCRIPT_BEAT_COUNT,
      beatRatios: [],
      scriptStrategy: "swipe_template",
      swipeTemplateAdId: null,
    };
  }
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { payload: true },
  });
  const payload =
    job?.payload && typeof job.payload === 'object'
      ? (job.payload as ScriptJobPayload)
      : null;
  const selectedId =
    typeof payload?.customerAnalysisJobId === 'string'
      ? payload.customerAnalysisJobId.trim()
      : '';
  const scriptStrategyRaw =
    typeof payload?.scriptStrategy === "string" ? payload.scriptStrategy.trim() : "";
  const scriptStrategy: ScriptStrategy =
    scriptStrategyRaw === "research_formula" ? "research_formula" : "swipe_template";
  const swipeTemplateAdIdRaw =
    typeof payload?.swipeTemplateAdId === "string" ? payload.swipeTemplateAdId.trim() : "";
  const targetDuration = normalizeTargetDurationValue(payload?.targetDuration);
  const beatCount = normalizeBeatCountValue(payload?.beatCount);
  const beatRatios = normalizeBeatRatios(payload?.beatRatios);
  return {
    customerAnalysisJobId: selectedId || null,
    targetDuration,
    beatCount,
    beatRatios,
    scriptStrategy,
    swipeTemplateAdId: swipeTemplateAdIdRaw || null,
  };
}

async function getAvatarForScript(
  projectId: string,
  customerAnalysisJobId: string | null
): Promise<AvatarSelection> {
  if (!customerAnalysisJobId) {
    const latestAnalysisJob = await prisma.job.findFirst({
      where: {
        projectId,
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.COMPLETED,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        runId: true,
        createdAt: true,
        updatedAt: true,
        resultSummary: true,
      },
    });

    if (latestAnalysisJob) {
      const summary = asObject(latestAnalysisJob.resultSummary);
      const avatarId = asString(summary?.avatarId);
      if (avatarId) {
        const avatar = await prisma.customerAvatar.findFirst({
          where: { id: avatarId, projectId },
        });
        if (avatar) {
          return {
            avatar,
            customerAnalysis: {
              jobId: latestAnalysisJob.id,
              runId: latestAnalysisJob.runId ?? null,
              createdAt: latestAnalysisJob.createdAt,
              completedAt: latestAnalysisJob.updatedAt,
            },
          };
        }
      }
    }

    const fallbackAvatar = await prisma.customerAvatar.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return { avatar: fallbackAvatar, customerAnalysis: null };
  }

  const analysisJob = await prisma.job.findFirst({
    where: {
      id: customerAnalysisJobId,
      projectId,
      type: JobType.CUSTOMER_ANALYSIS,
      status: JobStatus.COMPLETED,
    },
    select: {
      id: true,
      runId: true,
      createdAt: true,
      updatedAt: true,
      resultSummary: true,
    },
  });

  if (!analysisJob) {
    throw new Error('Selected research run is invalid or not completed.');
  }

  const summary = asObject(analysisJob.resultSummary);
  const avatarId = asString(summary?.avatarId);

  if (!avatarId) {
    throw new Error('Selected research run has no linked customer avatar.');
  }

  const avatar = await prisma.customerAvatar.findFirst({
    where: { id: avatarId, projectId },
  });

  if (!avatar) {
    throw new Error('Customer avatar for the selected research run was not found.');
  }

  return {
    avatar,
    customerAnalysis: {
      jobId: analysisJob.id,
      runId: analysisJob.runId ?? null,
      createdAt: analysisJob.createdAt,
      completedAt: analysisJob.updatedAt,
    },
  };
}

async function selectPatternResult(
  projectId: string,
  customerAnalysis: CustomerAnalysisContext | null
): Promise<PatternSelection> {
  const latest = await prisma.adPatternResult.findFirst({
    where: {
      projectId,
      job: {
        is: {
          projectId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      jobId: true,
      createdAt: true,
      rawJson: true,
      job: {
        select: {
          runId: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!customerAnalysis) {
    console.log('[ScriptGeneration] Pattern run selected', {
      projectId,
      source: 'latest',
      customerAnalysisJobId: null,
      customerAnalysisCompletedAt: null,
      patternJobId: latest?.jobId ?? null,
      patternRunId: latest?.job?.runId ?? null,
      patternResultCreatedAt: toIso(latest?.createdAt),
      patternJobUpdatedAt: toIso(latest?.job?.updatedAt ?? null),
    });
    return {
      source: 'latest',
      patternResult: latest
        ? {
            jobId: latest.jobId ?? null,
            createdAt: latest.createdAt,
            rawJson: latest.rawJson,
            jobRunId: latest.job?.runId ?? null,
            jobUpdatedAt: latest.job?.updatedAt ?? null,
          }
        : null,
    };
  }

  const afterCustomerAnalysisSameRun = customerAnalysis.runId
    ? await prisma.adPatternResult.findFirst({
        where: {
          projectId,
          job: {
            is: {
              projectId,
              type: JobType.PATTERN_ANALYSIS,
              status: JobStatus.COMPLETED,
              runId: customerAnalysis.runId,
              updatedAt: { gt: customerAnalysis.completedAt },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          jobId: true,
          createdAt: true,
          rawJson: true,
          job: {
            select: {
              runId: true,
              updatedAt: true,
            },
          },
        },
      })
    : null;

  const afterCustomerAnalysisAnyRun = await prisma.adPatternResult.findFirst({
    where: {
      projectId,
      job: {
        is: {
          projectId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.COMPLETED,
          updatedAt: { gt: customerAnalysis.completedAt },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      jobId: true,
      createdAt: true,
      rawJson: true,
      job: {
        select: {
          runId: true,
          updatedAt: true,
        },
      },
    },
  });

  const afterCustomerAnalysis =
    afterCustomerAnalysisSameRun ?? afterCustomerAnalysisAnyRun;

  const selected = afterCustomerAnalysis ?? latest;
  const source: PatternSelection["source"] = afterCustomerAnalysis
    ? 'after_customer_analysis'
    : 'latest';

  console.log('[ScriptGeneration] Pattern run selected', {
    projectId,
    source,
    customerAnalysisJobId: customerAnalysis.jobId,
    customerAnalysisRunId: customerAnalysis.runId,
    customerAnalysisCompletedAt: toIso(customerAnalysis.completedAt),
    patternJobId: selected?.jobId ?? null,
    patternRunId: selected?.job?.runId ?? null,
    patternResultCreatedAt: toIso(selected?.createdAt),
    patternJobUpdatedAt: toIso(selected?.job?.updatedAt ?? null),
  });

  return {
    source,
    patternResult: selected
      ? {
          jobId: selected.jobId ?? null,
          createdAt: selected.createdAt,
          rawJson: selected.rawJson,
          jobRunId: selected.job?.runId ?? null,
          jobUpdatedAt: selected.job?.updatedAt ?? null,
        }
      : null,
  };
}

async function selectSwipeFile(
  projectId: string,
  preferredRunId: string | null,
  requestedSwipeTemplateAdId: string | null
): Promise<SwipeFileSelection | null> {
  type SwipeCandidateRow = {
    id: string;
    createdAt: Date;
    rawJson: Prisma.JsonValue;
    swipeMetadata: Prisma.JsonValue | null;
  };
  const getCandidates = async (runId: string | null) =>
    prisma.$queryRaw<SwipeCandidateRow[]>(
      Prisma.sql`
        SELECT a."id", a."createdAt", a."rawJson", a."swipeMetadata"
        FROM "ad_asset" a
        LEFT JOIN "job" j ON j."id" = a."jobId"
        WHERE a."projectId" = ${projectId}
          AND COALESCE(a."isSwipeFile", false) = true
          AND COALESCE(a."contentViable", false) = true
          AND a."swipeMetadata" IS NOT NULL
          ${runId ? Prisma.sql`AND j."runId" = ${runId}` : Prisma.empty}
        ORDER BY
          COALESCE(
            NULLIF(regexp_replace(a."rawJson"->'qualityGate'->>'viewCount', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->'metrics'->>'views', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->'metrics'->>'view', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->'metrics'->>'plays', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->>'views', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->>'view', '[^0-9\\.-]', '', 'g'), '')::double precision,
            NULLIF(regexp_replace(a."rawJson"->>'plays', '[^0-9\\.-]', '', 'g'), '')::double precision,
            0
          ) DESC,
          a."createdAt" DESC
        LIMIT 40
      `
    );

  const sameRunCandidates = preferredRunId ? await getCandidates(preferredRunId) : [];
  const scopedCandidates =
    sameRunCandidates.length > 0 ? sameRunCandidates : await getCandidates(null);
  const candidateScope = sameRunCandidates.length > 0 ? "same_run" : "project_wide";

  const scoreSwipe = (rawJson: Prisma.JsonValue): number => {
    const raw = asObject(rawJson) ?? {};
    const metrics = asObject(raw.metrics) ?? {};
    const views = asNumber(metrics.views ?? metrics.view ?? metrics.plays);
    const engagementScore = asNumber(metrics.engagement_score);
    const retention3s = asNumber(metrics.retention_3s);
    const retention10s = asNumber(metrics.retention_10s);
    const ctr = asNumber(metrics.ctr);

    const viewsNorm = views && views > 0 ? Math.min(1, Math.log10(views + 1) / 7) : 0;
    const engagementNorm = engagementScore !== null ? Math.max(0, Math.min(1, engagementScore)) : 0;
    const r3Norm = retention3s !== null ? Math.max(0, Math.min(1, retention3s)) : 0;
    const r10Norm = retention10s !== null ? Math.max(0, Math.min(1, retention10s)) : 0;
    const ctrNorm = ctr !== null ? Math.max(0, Math.min(1, ctr)) : 0;

    return (
      0.35 * engagementNorm +
      0.25 * r3Norm +
      0.2 * r10Norm +
      0.1 * ctrNorm +
      0.1 * viewsNorm
    );
  };

  const candidates: Array<SwipeFileSelection & { createdAt: Date; score: number }> = [];
  for (const candidate of scopedCandidates) {
    const swipeMetadata = normalizeSwipeTemplate(candidate.swipeMetadata);
    if (!swipeMetadata) continue;
    candidates.push({
      id: candidate.id,
      views: extractSwipeViews(candidate.rawJson),
      swipeMetadata,
      createdAt: candidate.createdAt,
      score: scoreSwipe(candidate.rawJson),
    });
  }

  candidates.sort((a, b) => {
    const aViews = a.views ?? 0;
    const bViews = b.views ?? 0;
    if (aViews !== bViews) return bViews - aViews;
    if (a.score !== b.score) return b.score - a.score;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  if (requestedSwipeTemplateAdId) {
    const requested = candidates.find((c) => c.id === requestedSwipeTemplateAdId) ?? null;
    if (!requested) {
      throw new Error("Selected swipe template ad is not available for script generation.");
    }
    console.log("[ScriptGen] Swipe file selected by user:", requested.id);
    return {
      id: requested.id,
      views: requested.views ?? null,
      swipeMetadata: requested.swipeMetadata,
    };
  }

  const selected = candidates[0] ?? null;
  console.log("[ScriptGen] Swipe file selected:", selected?.id || "none", {
    candidateScope,
    preferredRunId,
    candidateCount: candidates.length,
  });
  if (!selected) return null;

  return {
    id: selected.id,
    views: selected.views ?? null,
    swipeMetadata: selected.swipeMetadata,
  };
}

async function selectProductIntelInput(
  projectId: string,
  projectName: string,
  customerAnalysis: CustomerAnalysisContext | null
): Promise<ProductIntelSelection> {
  const preferredRunId = customerAnalysis?.runId ?? null;
  const productCollectionJob = await selectProductCollectionJob(projectId, preferredRunId);

  if (productCollectionJob) {
    const fromCollection = await loadProductIntelFromCollectionJob(
      projectId,
      productCollectionJob,
      projectName
    );
    if (fromCollection) {
      console.log("[ScriptGeneration] Product intel selected", {
        projectId,
        source: "product_collection",
        productCollectionJobId: productCollectionJob.id,
        runId: productCollectionJob.runId,
        updatedAt: toIso(productCollectionJob.updatedAt),
      });
      return {
        productIntel: fromCollection,
        source: "product_collection",
        sourceDate: productCollectionJob.updatedAt ?? productCollectionJob.createdAt,
        productCollectionJobId: productCollectionJob.id,
      };
    }
  }

  const structured = await loadStructuredProductIntel(projectId);
  if (structured) {
    return {
      productIntel: {
        productName: structured.productName || projectName,
        url: structured.url,
        tagline: structured.tagline,
        ingredientsOrSpecs: structured.ingredientsOrSpecs,
        usp: structured.usp,
        keyFeatures: structured.keyFeatures,
        keyClaims: structured.keyClaims,
        targetAudience: structured.targetAudience,
        price: structured.price,
        rawHtml: structured.rawHtml,
      },
      source: "structured_table",
      sourceDate: structured.createdAt,
      productCollectionJobId: structured.jobId ?? null,
    };
  }

  const legacy = await prisma.productIntelligence.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  return {
    productIntel: (legacy?.insights as Record<string, unknown>) ?? {},
    source: "legacy",
    sourceDate: legacy?.createdAt ?? null,
    productCollectionJobId: null,
  };
}

/**
 * Main worker: Script generation for a project.
 */
export async function runScriptGeneration(args: {
  projectId: string;
  jobId?: string;
  customerAnalysisJobId?: string;
  targetDuration?: number;
  beatCount?: number;
  beatRatios?: BeatRatio[];
  scriptStrategy?: ScriptStrategy;
  swipeTemplateAdId?: string | null;
}) {
  const {
    projectId,
    jobId,
    customerAnalysisJobId,
    targetDuration,
    beatCount,
    beatRatios,
    scriptStrategy,
    swipeTemplateAdId,
  } = args;

  // Load dependencies:
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error('Project not found');
  }

  const requestedConfig = await getRequestedScriptGenerationConfig(jobId);
  const selectedCustomerAnalysisJobId =
    customerAnalysisJobId ?? requestedConfig.customerAnalysisJobId;
  const selectedTargetDuration = normalizeTargetDurationValue(
    targetDuration ?? requestedConfig.targetDuration
  );
  const selectedBeatCount = normalizeBeatCountValue(
    beatCount ?? requestedConfig.beatCount
  );
  const selectedBeatRatios = normalizeBeatRatios(
    beatRatios ?? requestedConfig.beatRatios
  );
  const selectedScriptStrategy: ScriptStrategy =
    scriptStrategy ?? requestedConfig.scriptStrategy;
  const selectedSwipeTemplateAdId =
    (typeof swipeTemplateAdId === "string" ? swipeTemplateAdId.trim() : "") ||
    requestedConfig.swipeTemplateAdId ||
    null;

  const avatarSelection = await getAvatarForScript(projectId, selectedCustomerAnalysisJobId);
  const avatar = avatarSelection.avatar;
  const selectedCustomerAnalysis = avatarSelection.customerAnalysis;

  const patternSelection = await selectPatternResult(projectId, selectedCustomerAnalysis);
  const patternResult = patternSelection.patternResult;
  const swipeFile =
    selectedScriptStrategy === "swipe_template"
      ? await selectSwipeFile(
          projectId,
          patternResult?.jobRunId ?? selectedCustomerAnalysis?.runId ?? null,
          selectedSwipeTemplateAdId
        )
      : null;
  if (selectedScriptStrategy === "swipe_template" && !swipeFile) {
    throw new Error(
      "No swipe template candidates found (same run and project-wide). Only quality-passed, pattern-promoted swipe ads can be used."
    );
  }

  const productIntelSelection = await selectProductIntelInput(
    projectId,
    project.name,
    selectedCustomerAnalysis
  );
  const productIntelPayload = stripGuaranteesFromProductIntelInput(
    productIntelSelection.productIntel
  );
  const productIntelDate = productIntelSelection.sourceDate;
  const researchSources: ResearchSourcesUsed = {
    customerAnalysisJobId: selectedCustomerAnalysis?.jobId ?? null,
    customerAnalysisRunDate: toIso(
      selectedCustomerAnalysis?.completedAt ?? selectedCustomerAnalysis?.createdAt ?? null
    ),
    patternAnalysisJobId: patternResult?.jobId ?? null,
    patternAnalysisRunDate: toIso(patternResult?.jobUpdatedAt ?? patternResult?.createdAt ?? null),
    productIntelDate: toIso(productIntelDate),
    swipeFileId: swipeFile?.id ?? null,
    swipeFileViews: swipeFile?.views ?? null,
    scriptStrategy: selectedScriptStrategy,
    requestedSwipeTemplateAdId: selectedSwipeTemplateAdId,
  };

  const missingDeps: string[] = [];
  if (!avatar) missingDeps.push('avatar');
  if (!Object.keys(productIntelPayload).length) missingDeps.push('product_intelligence');
  if (!patternResult) missingDeps.push('pattern_result');

  if (missingDeps.length > 0) {
    console.warn(
      'Script generation missing dependencies (dev mode):',
      missingDeps.join(', '),
    );
  }

  const normalizedPatternInputs = normalizePatternInputs(patternResult?.rawJson ?? null);
  const patterns = normalizedPatternInputs.patterns;
  const antiPatterns = normalizedPatternInputs.antiPatterns;
  const stackingRules = normalizedPatternInputs.stackingRules;

  if (!patterns.length && !missingDeps.includes('pattern_result')) {
    throw new Error('No patterns found in pattern brain for this project.');
  }

  const { system, prompt, promptInjections, validationInputs } = buildScriptPrompt({
    productName: project.name,
    avatar: (avatar?.persona as any) ?? {},
    productIntel: productIntelPayload,
    patternRawJson: patternResult?.rawJson ?? null,
    swipeFile,
    targetDuration: selectedTargetDuration,
    beatCount: selectedBeatCount,
    beatRatios: selectedBeatRatios,
    patterns,
    antiPatterns,
    stackingRules,
  });

  const scriptRecord = await prisma.script.create({
    data: {
      projectId,
      jobId,
      mergedVideoUrl: null,
      upscaledVideoUrl: null,
      status: ScriptStatus.PENDING,
      rawJson: {
        targetDuration: selectedTargetDuration,
        beatCount: selectedBeatCount,
        beatRatios: toJsonBeatRatios(selectedBeatRatios),
      },
      wordCount: 0,
    },
  });

  if (!env('ANTHROPIC_API_KEY')) {
    console.warn(
      'ANTHROPIC_API_KEY not set – dev mode, skipping LLM call for script generation',
    );
    return {
      script: scriptRecord,
      researchSources,
    };
  }

  console.log(
    "[ScriptGeneration] Anthropic prompt injections",
    markMissingPromptFields(promptInjections)
  );
  const responseText = await callAnthropic(system, prompt);
  const scriptJson = parseJsonFromLLM(responseText);
  const validationReport = validateScriptAgainstGates({
    scriptJson,
    copyReadyPhrases: validationInputs.copyReadyPhrases,
    verifiedNumericClaims: validationInputs.verifiedNumericClaims,
    successLooksLikeQuote: validationInputs.successLooksLikeQuote,
  });
  const voFull = buildVoFullFromScriptJson(scriptJson);
  const derivedWordCount = countWords(voFull);

  const updatedScript = await prisma.script.update({
    where: { id: scriptRecord.id },
    data: {
      rawJson: {
        ...(scriptJson as Record<string, unknown>),
        vo_full: voFull,
        targetDuration: selectedTargetDuration,
        beatCount: selectedBeatCount,
        validationReport,
      } as any,
      wordCount:
        typeof scriptJson.word_count === 'number'
          ? scriptJson.word_count
          : derivedWordCount,
      status: ScriptStatus.READY,
    },
  });

  return {
    script: updatedScript,
    researchSources,
    validationReport,
  };
}

/**
 * Convenience wrapper to run script generation as a Job.
 */
export async function startScriptGenerationJob(projectId: string, job: Job) {
  try {
    const sleepMs = devNumber("FF_WORKER_SLEEP_MS", 0);
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }

    if (flag("FF_FORCE_SCRIPT_FAIL")) {
      throw new Error("Transient: forced failure for retry test");
    }

    const generation = await runScriptGeneration({ projectId, jobId: job.id });
    const script = generation.script;
    const researchSources = generation.researchSources ?? {};
    const validationReport = generation.validationReport ?? null;
    const warningCount = Array.isArray(validationReport?.warnings)
      ? validationReport.warnings.length
      : 0;
    const completionSummary = {
      summary: `Script generated (scriptId=${script.id}, words=${script.wordCount ?? 'unknown'})${warningCount > 0 ? ` | ${warningCount} quality warning${warningCount === 1 ? "" : "s"}` : ""}`,
      scriptId: script.id,
      customerAnalysisRunDate: researchSources.customerAnalysisRunDate ?? null,
      patternAnalysisRunDate: researchSources.patternAnalysisRunDate ?? null,
      productIntelDate: researchSources.productIntelDate ?? null,
      researchSources,
      validationReport,
    };

    // Persist result metadata in the same completion transition.
    await updateJobStatus(job.id, JobStatus.COMPLETED, {
      resultSummary: completionSummary as any,
      error: Prisma.JsonNull,
    });

    return {
      jobId: job.id,
      scriptId: script.id,
      script,
    };
  } catch (err: any) {
    await updateJobStatus(job.id, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        error: err?.message ?? 'Unknown error during script generation',
      },
    });

    throw err;
  }
}
