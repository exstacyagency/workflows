import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import {
  assertProductSetupReferenceReachable,
  assertProductSetupReferenceUrl,
} from "@/lib/productSetupReferencePolicy";
import prisma from "./prisma.ts";
import { JobStatus, JobType, type Prisma } from "@prisma/client";
import { SORA_CLIP_LENGTHS, type SoraClipLength } from "./soraConstants";

type PanelTypeValue = "ON_CAMERA" | "B_ROLL_ONLY";

type BeatSpec = {
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
};

function buildSoraClipPlan(
  totalDurationSeconds: number,
  preferredClipCount: number,
  preferredClipDuration: SoraClipLength = 10,
): SoraClipLength[] {
  const target = Math.max(10, Math.round(totalDurationSeconds));
  const combos: SoraClipLength[][] = [];

  function dfs(remaining: number, acc: SoraClipLength[]) {
    if (remaining === 0) {
      combos.push([...acc]);
      return;
    }
    for (const len of SORA_CLIP_LENGTHS) {
      if (remaining - len < 0) continue;
      acc.push(len);
      dfs(remaining - len, acc);
      acc.pop();
    }
  }

  dfs(target, []);
  if (combos.length === 0) {
    const fallbackCount = Math.max(1, Math.round(target / 10));
    return Array.from({ length: fallbackCount }, () => 10);
  }

  combos.sort((a, b) => {
    const aPreferredHits = a.filter((len) => len === preferredClipDuration).length;
    const bPreferredHits = b.filter((len) => len === preferredClipDuration).length;
    if (aPreferredHits !== bPreferredHits) return bPreferredHits - aPreferredHits;
    const aDelta = Math.abs(a.length - preferredClipCount);
    const bDelta = Math.abs(b.length - preferredClipCount);
    if (aDelta !== bDelta) return aDelta - bDelta;
    // Prefer fewer clips when equally close.
    return a.length - b.length;
  });
  return combos[0];
}

function mergeSourceBeatsIntoClipBuckets(
  sourceBeats: BeatSpec[],
  clipCount: number,
): Array<Pick<BeatSpec, "beatLabel" | "vo">> {
  if (sourceBeats.length === 0) {
    return Array.from({ length: clipCount }, (_, idx) => ({
      beatLabel: `Beat ${idx + 1}`,
      vo: "",
    }));
  }

  const buckets: Array<Pick<BeatSpec, "beatLabel" | "vo">> = [];
  for (let idx = 0; idx < clipCount; idx += 1) {
    const startIdx = Math.floor((idx * sourceBeats.length) / clipCount);
    const endExclusive = Math.floor(((idx + 1) * sourceBeats.length) / clipCount);
    const group = sourceBeats.slice(startIdx, Math.max(startIdx + 1, endExclusive));
    const first = group[0] ?? sourceBeats[Math.min(startIdx, sourceBeats.length - 1)];
    const last = group[group.length - 1] ?? first;
    const label =
      group.length > 1
        ? `${first.beatLabel} -> ${last.beatLabel}`
        : first.beatLabel;
    const vo = group
      .map((beat) => beat.vo.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    buckets.push({ beatLabel: label, vo });
  }
  return buckets;
}

type StoryboardPanel = {
  panelType: PanelTypeValue;
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
  characterAction: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  transitionType: string;
  visualSpec: {
    lightingType: "soft diffused natural" | "harsh direct" | "golden hour";
    colorPalette: string;
    backgroundDescription: string;
    depthOfField: "shallow" | "natural" | "deep";
  };
};

type StoryboardPromptContext = {
  textOverlayPattern: string;
  visualFlowPattern: string | null;
  lifeStage: string | null;
  buyTriggerSituation: string | null;
  mechanismProcess: string | null;
};

type ProductReferenceImages = {
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterAnchorPrompt: string | null;
};

// Tiered storyboard prompt contract:
// Tier 1 = fixed structural constraints, Tier 2 = pass/fail quality gates, Tier 3 = optional creative guidance.
const STORYBOARD_SYSTEM_PROMPT =
  `You are a JSON API for UGC video storyboards. Output ONLY valid JSON. No markdown, no explanation, no extra fields.

Canonical field names - use these exactly:
- panelType (ON_CAMERA or B_ROLL_ONLY)
- beatLabel
- startTime
- endTime
- vo
- characterAction (string if ON_CAMERA, null if B_ROLL_ONLY)
- cameraDirection
- productPlacement
- bRollSuggestions (array of strings)
- transitionType
- environment
- characterAnchor

Any other field name is a critical error that breaks the pipeline.`;

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

async function loadProductReferenceImages(args: {
  projectId: string;
  productId: string | null;
}): Promise<ProductReferenceImages> {
  if (!args.productId) {
    return {
      creatorReferenceImageUrl: null,
      productReferenceImageUrl: null,
      characterAnchorPrompt: null,
    };
  }

  const rows = await prisma.$queryRaw<Array<{
    creatorReferenceImageUrl: string | null;
    productReferenceImageUrl: string | null;
    characterAnchorPrompt: string | null;
  }>>`
    SELECT
      "creator_reference_image_url" AS "creatorReferenceImageUrl",
      "product_reference_image_url" AS "productReferenceImageUrl",
      "character_anchor_prompt" AS "characterAnchorPrompt"
    FROM "product"
    WHERE "id" = ${args.productId}
      AND "project_id" = ${args.projectId}
    LIMIT 1
  `;

  const creatorReferenceImageUrl = asString(rows[0]?.creatorReferenceImageUrl);
  const productReferenceImageUrl = asString(rows[0]?.productReferenceImageUrl);
  const characterAnchorPrompt = asString(rows[0]?.characterAnchorPrompt);

  if (creatorReferenceImageUrl) {
    assertProductSetupReferenceUrl(creatorReferenceImageUrl, "creatorReferenceImageUrl");
    await assertProductSetupReferenceReachable(
      creatorReferenceImageUrl,
      "creatorReferenceImageUrl",
    );
  }
  if (productReferenceImageUrl) {
    assertProductSetupReferenceUrl(productReferenceImageUrl, "productReferenceImageUrl");
    await assertProductSetupReferenceReachable(
      productReferenceImageUrl,
      "productReferenceImageUrl",
    );
  }

  return {
    creatorReferenceImageUrl,
    productReferenceImageUrl,
    characterAnchorPrompt,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return rounded > 0 ? rounded : fallback;
}

function formatSeconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function parseDurationRange(duration: string | number | null): { start: number; end: number } | null {
  if (typeof duration !== "string") return null;
  const normalized = duration.trim();
  if (!normalized) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s?/i);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { start, end };
}

function extractTextContent(response: any): string {
  return Array.isArray(response?.content)
    ? response.content
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block?.text ?? ""))
        .join("\n")
        .trim()
    : "";
}

function parseJsonFromModelText(text: string): unknown {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Claude returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  const startCandidates = [objStart, arrStart].filter((value) => value >= 0);
  if (startCandidates.length === 0) {
    throw new Error("Claude response does not contain JSON.");
  }
  const start = Math.min(...startCandidates);
  const startChar = trimmed[start];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  for (let idx = start; idx < trimmed.length; idx += 1) {
    const char = trimmed[idx];
    if (char === startChar) depth += 1;
    if (char === endChar) depth -= 1;
    if (depth === 0) {
      end = idx;
      break;
    }
  }
  if (end === -1) {
    throw new Error("Claude response contains invalid JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizePanel(raw: unknown): Record<string, unknown> {
  const panel = asObject(raw) ?? {};
  const remapped: string[] = [];

  // bRollSuggestions - handle array or legacy string
  const bRollRaw =
    panel.bRollSuggestions ?? panel["B-roll Suggestions"] ?? panel["broll_suggestions"];
  const bRollSuggestions = Array.isArray(bRollRaw)
    ? bRollRaw.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : typeof bRollRaw === "string" && bRollRaw.trim().length > 0
      ? [bRollRaw.trim()]
      : [];

  // textOverlay - legacy field, fold into bRollSuggestions
  const textOverlay =
    asString(panel.textOverlay) ??
    asString(panel["Text Overlay"]) ??
    asString(panel["textOverlay"]) ??
    null;
  if (textOverlay && !bRollSuggestions.some((value) => value.includes(textOverlay))) {
    bRollSuggestions.unshift(`TEXT OVERLAY ${textOverlay}`);
    remapped.push("textOverlay -> bRollSuggestions");
  }

  // characterAction - accept legacy creatorAction
  const characterAction =
    asString(panel.characterAction) ??
    asString(panel.creatorAction) ??
    asString(panel["Character Action"]) ??
    asString(panel["creatorAction"]) ??
    null;
  if (!panel.characterAction && (panel.creatorAction || panel["Character Action"])) {
    remapped.push("creatorAction/Character Action -> characterAction");
  }

  // cameraDirection - accept legacy visualDescription
  const cameraDirection =
    asString(panel.cameraDirection) ??
    asString(panel["Camera Direction"]) ??
    asString(panel.visualDescription) ??
    asString(panel["Visual Description"]) ??
    "";
  if (!panel.cameraDirection && (panel.visualDescription || panel["Camera Direction"])) {
    remapped.push("visualDescription/Camera Direction -> cameraDirection");
  }

  // panelType - accept legacy clipType
  const panelType =
    asString(panel.panelType) ??
    asString(panel["Panel Type"]) ??
    (asString(panel.clipType) === "B_ROLL" ? "B_ROLL_ONLY" : null) ??
    (asString(panel["Clip Type"]) === "B_ROLL" ? "B_ROLL_ONLY" : null) ??
    "ON_CAMERA";
  if (!panel.panelType && (panel.clipType || panel["Clip Type"])) {
    remapped.push("clipType/Clip Type -> panelType");
  }

  if (remapped.length > 0) {
    console.warn(`[storyboard] normalizePanel remapped legacy fields: ${remapped.join(", ")}`);
  }

  return {
    panelType,
    beatLabel: asString(panel.beatLabel) ?? asString(panel["Beat Label"]) ?? "",
    startTime: asString(panel.startTime) ?? asString(panel["Start Time"]) ?? "",
    endTime: asString(panel.endTime) ?? asString(panel["End Time"]) ?? "",
    vo: asString(panel.vo) ?? asString(panel.VO) ?? "",
    characterAction,
    cameraDirection,
    productPlacement:
      asString(panel.productPlacement) ??
      asString(panel["Product Placement"]) ??
      "none",
    bRollSuggestions,
    transitionType: asString(panel.transitionType) ?? asString(panel["Transition Type"]) ?? "Cut",
    environment: asString(panel.environment) ?? asString(panel["Environment"]) ?? null,
  };
}

function validatePanel(rawPanel: unknown, beat: BeatSpec, index: number): StoryboardPanel {
  const panel = asObject(rawPanel);
  if (!panel) {
    throw new Error(`Panel ${index + 1} is not an object.`);
  }

  const panelTypeRaw = asString(panel.panelType);
  const panelType: PanelTypeValue = panelTypeRaw === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
  const characterAction = asString(panel.characterAction);
  const environment = asString(panel.environment) || null;
  const cameraDirection = asString(panel.cameraDirection) || "Natural handheld UGC framing.";
  const productPlacement = asString(panel.productPlacement) || "none";
  const transitionType = asString(panel.transitionType) || "Cut";
  if (panelType === "ON_CAMERA" && !characterAction) {
    throw new Error(`Panel ${index + 1} is ON_CAMERA but missing characterAction.`);
  }

  const bRollSuggestionsBase = asStringArray(panel.bRollSuggestions);

  return {
    panelType,
    beatLabel: asString(panel.beatLabel) || beat.beatLabel,
    startTime: asString(panel.startTime) || beat.startTime,
    endTime: asString(panel.endTime) || beat.endTime,
    vo: beat.vo,
    characterAction: panelType === "B_ROLL_ONLY" ? characterAction || null : characterAction!,
    environment: panelType === "B_ROLL_ONLY" ? environment || null : environment,
    cameraDirection,
    productPlacement,
    bRollSuggestions: bRollSuggestionsBase,
    transitionType,
    visualSpec: {
      lightingType: "soft diffused natural",
      colorPalette: "neutral warm tones",
      backgroundDescription:
        environment || "Real home/work environment matching creator setting",
      depthOfField: "natural",
    },
  };
}

function buildBeatSpecsFromScript(
  rawJson: unknown,
): {
  beatCount: number;
  targetDuration: number;
  beats: Array<BeatSpec & { clipDurationSeconds: SoraClipLength }>;
} {
  const root = asObject(rawJson) ?? {};
  const scenesRaw = Array.isArray(root.scenes) ? root.scenes : [];
  if (scenesRaw.length === 0) {
    throw new Error("Script has no scenes. Generate or save script beats before storyboard generation.");
  }

  const beatCountFromRaw = scenesRaw.length;
  const targetDurationFromRaw = normalizePositiveInt(root.targetDuration, 0);
  const sourceBeatCount = beatCountFromRaw;
  const fallbackTargetDuration =
    targetDurationFromRaw > 0 ? targetDurationFromRaw : Math.max(10, sourceBeatCount * 10);
  const targetDuration = fallbackTargetDuration;
  const fallbackSecondsPerBeat = targetDuration / Math.max(1, sourceBeatCount);

  const sourceBeats = scenesRaw.map((scene, index) => {
    const sceneObj = asObject(scene) ?? {};
    const label = asString(sceneObj.beat) || `Beat ${index + 1}`;
    const vo = asString(sceneObj.vo) || "";
    const durationParsed = parseDurationRange(
      typeof sceneObj.duration === "string" || typeof sceneObj.duration === "number"
        ? sceneObj.duration
        : null,
    );

    const fallbackStart = fallbackSecondsPerBeat * index;
    const fallbackEnd = index === sourceBeatCount - 1 ? targetDuration : fallbackStart + fallbackSecondsPerBeat;
    const start = durationParsed?.start ?? fallbackStart;
    const end = durationParsed?.end ?? fallbackEnd;

    return {
      beatLabel: label,
      startTime: `${formatSeconds(start)}s`,
      endTime: `${formatSeconds(end)}s`,
      vo,
    };
  });

  const clipPlan = buildSoraClipPlan(targetDuration, sourceBeats.length);
  const clipBuckets = mergeSourceBeatsIntoClipBuckets(sourceBeats, clipPlan.length);

  let timelineCursor = 0;
  const soraScenes: Array<BeatSpec & { clipDurationSeconds: SoraClipLength }> = clipPlan.map((clipDurationSeconds, idx) => {
    const start = timelineCursor;
    const end = start + clipDurationSeconds;
    timelineCursor = end;
    const source = clipBuckets[idx] ?? { beatLabel: `Beat ${idx + 1}`, vo: "" };
    return {
      beatLabel: source.beatLabel || `Beat ${idx + 1}`,
      vo: source.vo || "",
      startTime: `${formatSeconds(start)}s`,
      endTime: `${formatSeconds(end)}s`,
      clipDurationSeconds,
    };
  });

  return { beatCount: soraScenes.length, targetDuration, beats: soraScenes };
}

function buildStoryboardUserPrompt(args: {
  beatCount: number;
  targetDuration: number;
  beats: BeatSpec[];
  textOverlayPattern: string;
  lifeStage: string | null;
  buyTriggerSituation: string | null;
  mechanismProcess: string | null;
  visualFlowPattern: string | null;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
  characterAnchorPrompt: string | null;
}): string {
  const {
    beatCount,
    targetDuration,
    beats,
    textOverlayPattern,
    lifeStage,
    buyTriggerSituation,
    mechanismProcess,
    visualFlowPattern,
    creatorReferenceImageUrl,
    productReferenceImageUrl,
    characterAnchorPrompt,
  } = args;
  const beatLines = beats
    .map(
      (beat, index) =>
        `- Beat ${index + 1}: ${beat.beatLabel} (${beat.startTime}-${beat.endTime}) | VO: "${beat.vo}"`
    )
    .join("\n");
  return `TIER 1 - STRUCTURE (NON-NEGOTIABLE)
panels required: ${beatCount} — one per beat, no exceptions.
${beatLines}

TIER 2 - FIELD RULES
vo: copy exact VO from beat spec above, verbatim
creatorAction: specific physical action (not generic). null if B_ROLL.
textOverlay: exact copy + timing — format: "COPY (Xs-Xs)"
visualDescription: one sentence only — what Sora renders
productPlacement: when and how product appears, or "none"
clipType: ON_CAMERA if creator speaks to camera. B_ROLL if product demo, hands, environment, or montage with no creator face.

TIER 3 - CREATIVE CONTEXT (inform visuals, don't force)
lifeStage: ${lifeStage || "not provided"}
buyTriggerSituation: ${buyTriggerSituation || "not provided"}
mechanismProcess: ${mechanismProcess || "not provided"}
${visualFlowPattern ? `visualFlow: ${visualFlowPattern}` : ""}
${creatorReferenceImageUrl ? `creatorReference: ${creatorReferenceImageUrl}` : ""}
${productReferenceImageUrl ? `productReference: ${productReferenceImageUrl}` : ""}
${characterAnchorPrompt ? `CHARACTER ANCHOR (copy into every panel's characterAnchor field verbatim):\n${characterAnchorPrompt}` : ""}

OUTPUT SCHEMA — use these exact field names, no others:
{
  "panels": [
    {
      "panelType": "ON_CAMERA",
      "beatLabel": "Hook",
      "startTime": "0s",
      "endTime": "10s",
      "vo": "exact vo text here",
      "characterAction": "specific physical action — null if B_ROLL_ONLY",
      "cameraDirection": "single sentence — what Sora renders",
      "productPlacement": "when and how product appears, or none",
      "bRollSuggestions": ["TEXT OVERLAY COPY HERE (0s-3s)"],
      "transitionType": "Cut",
      "environment": "real location description or null",
      "characterAnchor": "copy the provided CHARACTER ANCHOR verbatim when present"
    }
  ]
}

FIELD RULES:
- panelType: ON_CAMERA if creator speaks to camera. B_ROLL_ONLY if product demo, hands, or montage with no creator face.
- characterAction: specific physical action, not generic. null if B_ROLL_ONLY.
- cameraDirection: one sentence describing what Sora should render.
- bRollSuggestions: array. Include text overlays as "TEXT OVERLAY COPY (Xs-Xs)".
- vo: copy exact VO from beat spec above, verbatim.
- transitionType: Cut or Fade.

BANNED FIELD NAMES — these will break the pipeline:
clipType, creatorAction, textOverlay, visualDescription, 
Character Action, Camera Direction, B-roll Suggestions, 
Character Handle, Environment, Transition Type, Clip Type`;
}

function extractPatternTextOverlays(rawJson: unknown): string | null {
  const root = asObject(rawJson) ?? {};
  const patternsRoot = asObject(root.patterns) ?? root;
  const prescriptiveGuidance =
    asObject(patternsRoot.prescriptiveGuidance) ??
    asObject(root.prescriptiveGuidance) ??
    null;

  const directCandidates: unknown[] = [
    prescriptiveGuidance?.textOverlays,
    prescriptiveGuidance?.textOverlay,
    patternsRoot.textOverlays,
    root.textOverlays,
  ];
  for (const candidate of directCandidates) {
    const parsed = asString(candidate);
    if (parsed) return parsed;
  }

  const arrayCandidates: unknown[] = [
    patternsRoot.textOverlayPatterns,
    root.textOverlayPatterns,
  ];
  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const value = asString(entry);
      if (value) return value;
      const entryObj = asObject(entry);
      const nested = asString(entryObj?.pattern) || asString(entryObj?.description) || asString(entryObj?.name);
      if (nested) return nested;
    }
  }

  return null;
}

function extractPatternVisualFlow(rawJson: unknown): string | null {
  const root = asObject(rawJson) ?? {};
  const patternsRoot = asObject(root.patterns) ?? root;
  const prescriptiveGuidance =
    asObject(patternsRoot.prescriptiveGuidance) ??
    asObject(root.prescriptiveGuidance) ??
    null;

  const candidates: unknown[] = [
    prescriptiveGuidance?.visualFlow,
    prescriptiveGuidance?.visual_flow,
    patternsRoot.visualFlow,
    root.visualFlow,
  ];
  for (const candidate of candidates) {
    const parsed = asString(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractAvatarContext(personaRaw: unknown): {
  lifeStage: string | null;
  buyTriggerSituation: string | null;
} {
  const root = asObject(personaRaw) ?? {};
  const avatar = asObject(root.avatar) ?? {};
  const profile = asObject(avatar.profile) ?? asObject(root.profile) ?? {};
  const buyTrigger = asObject(root.buy_trigger) ?? asObject(avatar.buy_trigger) ?? {};

  const lifeStage =
    asString(avatar.life_stage) ||
    asString(profile.life_stage) ||
    asString(root.life_stage) ||
    null;
  const buyTriggerSituation =
    asString(buyTrigger.situation) ||
    asString(buyTrigger.trigger) ||
    null;

  return {
    lifeStage,
    buyTriggerSituation,
  };
}

function extractMechanismProcessFromCollectionPayload(payloadRaw: unknown): string | null {
  const payload = asObject(payloadRaw) ?? {};
  const result = asObject(payload.result) ?? {};
  const intel = asObject(result.intel) ?? {};
  if (Object.keys(intel).length === 0) return null;

  const direct =
    asString(intel.mechanismProcess) ||
    asString(intel.mechanism_process) ||
    asString(intel.process) ||
    null;
  if (direct) return direct;

  const usage = asString(intel.usage);
  const format = asString(intel.format);
  const mainBenefit = asString(intel.main_benefit) || asString(intel.mainBenefit);
  const combined = [usage, format, mainBenefit].filter((entry): entry is string => Boolean(entry)).join("; ");
  if (combined) return combined;

  const claimFallback = asStringArray(intel.specific_claims ?? intel.key_claims ?? intel.keyClaims)[0] ?? null;
  return claimFallback || asString(intel.tagline) || null;
}

async function loadStoryboardPromptContextForScriptRun(args: {
  projectId: string;
  runId: string | null;
}): Promise<StoryboardPromptContext> {
  const { projectId, runId } = args;
  const defaultTextOverlayPattern =
    "Single keywords at emotional peaks with exact timing ranges (e.g., 3.0s-3.6s: \"CRASH\").";
  if (!runId) {
    return {
      textOverlayPattern: defaultTextOverlayPattern,
      visualFlowPattern: null,
      lifeStage: null,
      buyTriggerSituation: null,
      mechanismProcess: null,
    };
  }

  let textOverlayPattern = defaultTextOverlayPattern;
  let visualFlowPattern: string | null = null;
  let lifeStage: string | null = null;
  let buyTriggerSituation: string | null = null;
  let mechanismProcess: string | null = null;

  const patternResult = await prisma.adPatternResult.findFirst({
    where: {
      projectId,
      job: {
        is: {
          projectId,
          runId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      jobId: true,
      rawJson: true,
    },
  });
  const extractedTextOverlayPattern = extractPatternTextOverlays(patternResult?.rawJson);
  if (extractedTextOverlayPattern) {
    textOverlayPattern = extractedTextOverlayPattern;
  }
  visualFlowPattern = extractPatternVisualFlow(patternResult?.rawJson);

  const customerAnalysisJob = await prisma.job.findFirst({
    where: {
      projectId,
      runId,
      type: JobType.CUSTOMER_ANALYSIS,
      status: JobStatus.COMPLETED,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      resultSummary: true,
    },
  });
  const customerSummary = asObject(customerAnalysisJob?.resultSummary) ?? {};
  const avatarId = asString(customerSummary.avatarId) || asString(customerSummary.avatar_id);
  if (avatarId) {
    const avatar = await prisma.customerAvatar.findFirst({
      where: { id: avatarId, projectId },
      select: {
        persona: true,
      },
    });
    const avatarContext = extractAvatarContext(avatar?.persona);
    lifeStage = avatarContext.lifeStage;
    buyTriggerSituation = avatarContext.buyTriggerSituation;
  }

  const productCollectionJob = await prisma.job.findFirst({
    where: {
      projectId,
      runId,
      type: JobType.PRODUCT_DATA_COLLECTION,
      status: JobStatus.COMPLETED,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      payload: true,
    },
  });
  mechanismProcess = extractMechanismProcessFromCollectionPayload(productCollectionJob?.payload);

  console.log("[storyboardGeneration] Tiered prompt context:", {
    projectId,
    runId,
    patternJobId: patternResult?.jobId ?? null,
    textOverlayPattern,
    visualFlowPattern,
    lifeStage,
    buyTriggerSituation,
    mechanismProcess,
  });

  return {
    textOverlayPattern,
    visualFlowPattern,
    lifeStage,
    buyTriggerSituation,
    mechanismProcess,
  };
}

export async function generateStoryboard(
  scriptId: string,
  opts?: {
    productId?: string | null;
    characterHandle?: string | null;
    storyboardMode?: "ai" | "manual";
    manualPanels?: Array<{
      beatLabel?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      vo?: string | null;
      creatorAction?: string | null;
      textOverlay?: string | null;
      visualDescription?: string | null;
      productPlacement?: string | null;
    }> | null;
  },
): Promise<{
  storyboardId: string;
  panelCount: number;
  targetDuration: number;
}> {
  const normalizedScriptId = String(scriptId ?? "").trim();
  if (!normalizedScriptId) {
    throw new Error("scriptId is required for storyboard generation.");
  }

  const script = await prisma.script.findUnique({
    where: { id: normalizedScriptId },
    select: {
      id: true,
      projectId: true,
      rawJson: true,
      job: {
        select: {
          runId: true,
          payload: true,
        },
      },
    },
  });
  if (!script) {
    throw new Error(`Script not found for id=${normalizedScriptId}.`);
  }

  const { beatCount, targetDuration, beats } = buildBeatSpecsFromScript(
    script.rawJson,
  );
  if (!beats.length) {
    throw new Error("Script scenes are empty; cannot generate storyboard.");
  }
  const storyboardMode = opts?.storyboardMode === "manual" ? "manual" : "ai";

  const scriptRunId = script.job?.runId ?? null;
  const scriptJobPayload = asObject(script.job?.payload) ?? {};
  const explicitProductId = asString(opts?.productId) || null;
  const explicitCharacterHandle = asString(opts?.characterHandle) || null;
  const normalizedCharacterHandle = explicitCharacterHandle
    ? `@${explicitCharacterHandle.replace(/^@+/, "")}`
    : null;
  const productIdFromScriptPayload = asString(scriptJobPayload.productId) || null;
  const effectiveProductId = explicitProductId || productIdFromScriptPayload;
  const productReferenceImages = await loadProductReferenceImages({
    projectId: script.projectId,
    productId: effectiveProductId,
  });
  const promptContext = await loadStoryboardPromptContextForScriptRun({
    projectId: script.projectId,
    runId: scriptRunId,
  });
  let panels: StoryboardPanel[];
  if (storyboardMode === "manual") {
    const manualPanels = Array.isArray(opts?.manualPanels) ? opts?.manualPanels : [];
    const hasManualPanels = manualPanels.length > 0;
    if (hasManualPanels && manualPanels.length !== beats.length) {
      throw new Error(
        `Manual storyboard requires ${beats.length} panel(s), received ${manualPanels.length}.`,
      );
    }

    panels = beats.map((beat, index) => {
      const manual = hasManualPanels
        ? ((manualPanels[index] ?? {}) as {
            beatLabel?: string | null;
            startTime?: string | null;
            endTime?: string | null;
            vo?: string | null;
            creatorAction?: string | null;
            textOverlay?: string | null;
            visualDescription?: string | null;
            productPlacement?: string | null;
          })
        : null;
      const textOverlay = asString(manual?.textOverlay);
      const visualDescription = asString(manual?.visualDescription);
      return {
        panelType: "ON_CAMERA",
        beatLabel: asString(manual?.beatLabel) || beat.beatLabel,
        startTime: asString(manual?.startTime) || beat.startTime,
        endTime: asString(manual?.endTime) || beat.endTime,
        vo: asString(manual?.vo) || beat.vo,
        characterAction:
          asString(manual?.creatorAction) || "Describe creator action for this beat.",
        environment: visualDescription || "Describe location and visual setup for this beat.",
        cameraDirection: visualDescription || "Describe framing, angle, and movement for this beat.",
        productPlacement:
          asString(manual?.productPlacement) || "Add exact timing for product placement in this beat.",
        bRollSuggestions: textOverlay ? [`TEXT OVERLAY ${textOverlay}`] : [],
        transitionType: "Cut",
        visualSpec: {
          lightingType: "soft diffused natural",
          colorPalette: "neutral warm tones",
          backgroundDescription: "Real home/work environment matching creator setting",
          depthOfField: "natural",
        },
      };
    });
  } else {
    const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
      timeout: 90_000,
    });
    const userPrompt = buildStoryboardUserPrompt({
      beatCount,
      targetDuration,
      beats,
      textOverlayPattern: promptContext.textOverlayPattern,
      lifeStage: promptContext.lifeStage,
      buyTriggerSituation: promptContext.buyTriggerSituation,
      mechanismProcess: promptContext.mechanismProcess,
      visualFlowPattern: promptContext.visualFlowPattern,
      creatorReferenceImageUrl: productReferenceImages.creatorReferenceImageUrl,
      productReferenceImageUrl: productReferenceImages.productReferenceImageUrl,
      characterAnchorPrompt: productReferenceImages.characterAnchorPrompt,
    });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: STORYBOARD_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    console.log("[storyboardGeneration] Anthropic raw response:", response);
    const responseText = extractTextContent(response);
    const parsed = parseJsonFromModelText(responseText);
    const parsedObject = asObject(parsed);
    const panelsRaw = Array.isArray(parsedObject?.panels)
      ? parsedObject.panels
      : Array.isArray(parsed)
        ? parsed
        : [];
    console.log("[storyboardGeneration] Parsed panels:", {
      panelCount: panelsRaw.length,
      panels: panelsRaw,
    });

    if (panelsRaw.length !== beatCount) {
      throw new Error(
        `Storyboard panel count mismatch. Expected ${beatCount} panels but Claude returned ${panelsRaw.length}.`,
      );
    }

    panels = panelsRaw.map((panel, index) =>
      validatePanel(normalizePanel(panel), beats[index] ?? beats[beats.length - 1], index),
    );
  }

  const existingStoryboard = await prisma.storyboard.findFirst({
    where: {
      projectId: script.projectId,
      scriptId: script.id,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const storyboard =
      existingStoryboard?.id
        ? { id: existingStoryboard.id }
        : await tx.storyboard.create({
            data: {
              projectId: script.projectId,
              scriptId: script.id,
            },
            select: { id: true },
          });

    await tx.storyboardScene.deleteMany({
      where: { storyboardId: storyboard.id },
    });

    for (let index = 0; index < panels.length; index += 1) {
      const panel = panels[index];
      const panelWithReferences: Record<string, unknown> = {
        ...panel,
        ...(productReferenceImages.creatorReferenceImageUrl
          ? { creatorReferenceImageUrl: productReferenceImages.creatorReferenceImageUrl }
          : {}),
        ...(productReferenceImages.productReferenceImageUrl
          ? { productReferenceImageUrl: productReferenceImages.productReferenceImageUrl }
          : {}),
        ...(productReferenceImages.characterAnchorPrompt
          ? { characterAnchor: productReferenceImages.characterAnchorPrompt }
          : {}),
        ...(panel.panelType === "ON_CAMERA" && normalizedCharacterHandle
          ? { characterHandle: normalizedCharacterHandle }
          : {}),
      };
      await tx.storyboardScene.create({
        data: {
          storyboardId: storyboard.id,
          sceneNumber: index + 1,
          clipDurationSeconds: beats[index]?.clipDurationSeconds ?? 10,
          // TODO: Restore after panelType migration runs.
          // panelType: panel.panelType,
          status: "ready",
          rawJson: panelWithReferences as Prisma.InputJsonValue,
          approved: true,
        },
      });
    }

    return storyboard;
  });
  const storedPanelsCount = await prisma.storyboardScene.count({
    where: { storyboardId: result.id },
  });
  console.log("[storyboardGeneration] Storyboard write complete:", {
    storyboardId: result.id,
    expectedPanels: panels.length,
    storedPanelsCount,
  });

  return {
    storyboardId: result.id,
    panelCount: panels.length,
    targetDuration,
  };
}
