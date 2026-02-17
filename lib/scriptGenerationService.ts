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

function firstStringInArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const normalized = asString(entry);
    if (normalized) return normalized;
  }
  return null;
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
    const mapped = timingPatterns
      .slice(0, fallbackBeats.length)
      .map((entry, index) => {
        const fallback = fallbackBeats[index] ?? fallbackBeats[fallbackBeats.length - 1];
        return {
          label: normalizeTimingLabel(entry, fallback.label),
          duration: normalizeTimingDuration(entry, fallback.duration),
          guidance: normalizeTimingGuidance(entry),
        };
      });

    while (mapped.length < fallbackBeats.length) {
      mapped.push(fallbackBeats[mapped.length]);
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

  return (
    asString(prescriptiveGuidance?.transferFormula) ||
    asString(prescriptiveGuidance?.transfer_formula) ||
    null
  );
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

/**
 * Build script prompt from avatar, product intel, and pattern brain.
 */
function buildScriptPrompt(args: {
  productName: string;
  avatar: any;
  productIntel: any;
  patternRawJson: unknown;
  targetDuration: number;
  beatCount: number;
  patterns: Pattern[];
  antiPatterns: AntiPattern[];
  stackingRules: StackingRule[];
}): { system: string; prompt: string; promptInjections: PromptInjectionValues } {
  const {
    productName,
    avatar,
    productIntel,
    patternRawJson,
    targetDuration,
    beatCount,
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
  const schemaTimingPlan = buildDefaultBeatPlan(targetDuration, beatCount);
  const dynamicWordCeiling = Math.round((targetDuration / 60) * 135 * 0.9);
  const perBeatWords = Math.max(4, Math.round(dynamicWordCeiling / beatCount));
  const perBeatMinWords = Math.max(3, Math.floor(perBeatWords * 0.75));
  const perBeatMaxWords = Math.max(perBeatMinWords + 1, Math.ceil(perBeatWords * 1.25));
  const beatWordGuideLines = Array.from({ length: beatCount }, (_, index) =>
    `- Beat ${index + 1}: ~${perBeatMinWords}-${perBeatMaxWords} words`
  ).join("\n");
  const beatStructureLines = beatPlan.beats
    .map((beat, index) => {
      const formulaComponent = beat.formulaComponent || "MISSING_FORMULA_COMPONENT";
      return `BEAT ${index + 1} — ${beat.label} (${beat.duration}) | FORMULA REQUIREMENT: ${formulaComponent} | Write VO that executes this formula component specifically. This is not optional context. This beat must deliver ${formulaComponent} or the psychological contract with the viewer breaks.`;
    })
    .join("\n");
  const outputSceneSchema = schemaTimingPlan
    .map(
      (timedBeat, index) => {
        const beat = beatPlan.beats[index] ?? timedBeat;
        return `    {\n      "beat": "${escapePromptJsonString(beat.label)}",\n      "duration": "${escapePromptJsonString(timedBeat.duration)}",\n      "vo": "text"\n    }`;
      }
    )
    .join(",\n");

  const system =
    "You are an expert TikTok direct-response creative director who has studied thousands of high-converting UGC ads. You understand scroll psychology, pattern interrupts, and what makes someone stop, watch, and buy in under 32 seconds. You write scripts where every word earns its place. You know the difference between content that entertains and content that converts. Output ONLY valid JSON. No markdown. No explanation. No preamble.";

  const prompt = `INPUTS
Product: ${productName}
Mechanism: ${mechanismProcess}
Avatar: ${avatarAge}yo ${avatarGender}, ${avatarJob}
Psycho: ${psychographics}
Goal: ${goal}
Blocker: ${blockerFear}
Blocker quote: "${blockerQuote}"
Verified numeric claims from product intelligence:
${verifiedNumericClaims.length > 0 ? verifiedNumericClaims.map((claim, idx) => `${idx + 1}. ${claim}`).join('\n') : "None provided"}

REQUIRED CUSTOMER LANGUAGE (MANDATORY)
copy_ready_phrases:
${copyReadyPhrasesList}
success_looks_like quote:
"${successLooksLikeQuote || "MISSING"}"
buy_trigger quote:
"${buyTriggerQuote || "MISSING"}"
buy_trigger situation:
"${buyTriggerSituation || "MISSING"}"
life_stage:
"${lifeStage || "MISSING"}"
urgency_level:
"${urgencyLevel || "MISSING"}"
top competitor_landmines quote:
"${competitorLandmineTopQuote || "MISSING"}"

PATTERN INTELLIGENCE
Hook: ${hookPatternName} (${hookPattern?.occurrence_rate || 'unknown'} occurrence)
Example: "${hookPatternExample}"
Timing: ${hookPattern?.timing || '0-3s'}
Visual: ${hookPattern?.visual_notes || 'N/A'}

Proof: ${proofPatternName} (${proofPattern?.occurrence_rate || 'unknown'} occurrence)
How: ${proofPatternDescription}
Timing: ${proofPattern?.timing || ''}
Visual: ${proofPattern?.visual_notes || ''}

Synergy: ${amplifySynergy}
WHY synergy works: ${amplifyRule?.baseline_comparison || amplifyRule?.reason || 'patterns reinforce belief and reduce friction'}

EXECUTION RULES
Duration: ${targetDuration}s (${beatCount}-beat UGC flow)
Beat plan source: ${beatPlan.source}
${beatCount}-beat structure:
${beatStructureLines}

VO: ${dynamicWordCeiling} words max @ 135 WPM (90% density target)
${beatWordGuideLines}

CLAIM SAFETY RULES
- Specific numeric claims in the script must come from the "Verified numeric claims from product intelligence" list above.
- All claims require a verified source in the product intelligence data.
- If no claim exists, use qualitative customer language instead.
- Do not invent claims or statistics.
- Do not invent performance statistics, percentages, timeframes, or quantified outcomes.
- If no relevant numeric claim exists for a beat, use emotional language instead of fabricated numbers.

MANDATORY LANGUAGE RULES
- At least two phrases from copy_ready_phrases must appear verbatim or near-verbatim in the final script.
- The Payoff beat must echo the emotional outcome from success_looks_like.
- The Problem Agitation beat must use language patterns from competitor_landmines failures, not generic supplement frustration.
- The Personal Context beat must reference the specific high-stakes situation that triggers purchase (for example: deadline pressure, project-based cognitive demand, performance under pressure). Generic "working professional" framing is not acceptable. The viewer must recognize their exact situation within 3 seconds.
- If the beat labels differ, apply the Payoff rule to the final beat and apply the Problem Agitation rule to the beat that escalates pain/tension.

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
    },
  };
}

type ScriptJobPayload = {
  customerAnalysisJobId?: unknown;
  targetDuration?: unknown;
  beatCount?: unknown;
};

type ScriptGenerationJobConfig = {
  customerAnalysisJobId: string | null;
  targetDuration: number;
  beatCount: number;
};

async function getRequestedScriptGenerationConfig(jobId?: string): Promise<ScriptGenerationJobConfig> {
  if (!jobId) {
    return {
      customerAnalysisJobId: null,
      targetDuration: DEFAULT_SCRIPT_TARGET_DURATION,
      beatCount: DEFAULT_SCRIPT_BEAT_COUNT,
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
  const targetDuration = normalizeTargetDurationValue(payload?.targetDuration);
  const beatCount = normalizeBeatCountValue(payload?.beatCount);
  return {
    customerAnalysisJobId: selectedId || null,
    targetDuration,
    beatCount,
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
}) {
  const { projectId, jobId, customerAnalysisJobId, targetDuration, beatCount } = args;

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

  const avatarSelection = await getAvatarForScript(projectId, selectedCustomerAnalysisJobId);
  const avatar = avatarSelection.avatar;
  const selectedCustomerAnalysis = avatarSelection.customerAnalysis;

  const patternSelection = await selectPatternResult(projectId, selectedCustomerAnalysis);
  const patternResult = patternSelection.patternResult;

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

  const { system, prompt, promptInjections } = buildScriptPrompt({
    productName: project.name,
    avatar: (avatar?.persona as any) ?? {},
    productIntel: productIntelPayload,
    patternRawJson: patternResult?.rawJson ?? null,
    targetDuration: selectedTargetDuration,
    beatCount: selectedBeatCount,
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

  const updatedScript = await prisma.script.update({
    where: { id: scriptRecord.id },
    data: {
      rawJson: {
        ...(scriptJson as Record<string, unknown>),
        targetDuration: selectedTargetDuration,
        beatCount: selectedBeatCount,
      } as any,
      wordCount:
        typeof scriptJson.word_count === 'number'
          ? scriptJson.word_count
          : null,
      status: ScriptStatus.READY,
    },
  });

  return {
    script: updatedScript,
    researchSources,
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
    const completionSummary = {
      summary: `Script generated (scriptId=${script.id}, words=${script.wordCount ?? 'unknown'})`,
      scriptId: script.id,
      customerAnalysisRunDate: researchSources.customerAnalysisRunDate ?? null,
      patternAnalysisRunDate: researchSources.patternAnalysisRunDate ?? null,
      productIntelDate: researchSources.productIntelDate ?? null,
      researchSources,
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
