import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import prisma from "./prisma.ts";
import { JobStatus, JobType, type Prisma } from "@prisma/client";
import { validateStoryboardAgainstGates, type StoryboardValidationReport } from "@/lib/storyboardValidation";

type PanelTypeValue = "ON_CAMERA" | "B_ROLL_ONLY";

type BeatSpec = {
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
};

const SORA_CLIP_LENGTHS = [10, 15] as const;
type SoraClipLength = typeof SORA_CLIP_LENGTHS[number];

function snapToSoraClip(durationSeconds: number): SoraClipLength {
  return durationSeconds <= 12 ? 10 : 15;
}

function splitBeatIntoClips(
  beat: BeatSpec & { durationSeconds: number }
): Array<BeatSpec & { clipDurationSeconds: SoraClipLength }> {
  const { durationSeconds, beatLabel, vo, startTime, endTime } = beat;

  if (durationSeconds <= 15) {
    return [{ beatLabel, vo, startTime, endTime, clipDurationSeconds: snapToSoraClip(durationSeconds) }];
  }

  const clips: Array<BeatSpec & { clipDurationSeconds: SoraClipLength }> = [];
  let remaining = durationSeconds;
  let clipIndex = 1;
  let currentStart = parseFloat(startTime);

  while (remaining > 0) {
    const clipLength: SoraClipLength = remaining > 15 ? 15 : snapToSoraClip(remaining);
    const clipEnd = currentStart + clipLength;
    clips.push({
      beatLabel: `${beatLabel} (${clipIndex})`,
      vo: clipIndex === 1 ? vo : "",
      startTime: `${formatSeconds(currentStart)}s`,
      endTime: `${formatSeconds(clipEnd)}s`,
      clipDurationSeconds: clipLength,
    });
    remaining -= clipLength;
    currentStart = clipEnd;
    clipIndex++;
  }
  return clips;
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
};

// Tiered storyboard prompt contract:
// Tier 1 = fixed structural constraints, Tier 2 = pass/fail quality gates, Tier 3 = optional creative guidance.
const STORYBOARD_SYSTEM_PROMPT =
  "You're directing a UGC video shot on a phone. Real creator. Real environment. No actors. Output ONLY valid JSON.";

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
    };
  }

  const rows = await prisma.$queryRaw<Array<{
    creatorReferenceImageUrl: string | null;
    productReferenceImageUrl: string | null;
  }>>`
    SELECT
      "creator_reference_image_url" AS "creatorReferenceImageUrl",
      "product_reference_image_url" AS "productReferenceImageUrl"
    FROM "product"
    WHERE "id" = ${args.productId}
      AND "project_id" = ${args.projectId}
    LIMIT 1
  `;

  return {
    creatorReferenceImageUrl: asString(rows[0]?.creatorReferenceImageUrl),
    productReferenceImageUrl: asString(rows[0]?.productReferenceImageUrl),
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

function validatePanel(rawPanel: unknown, beat: BeatSpec, index: number): StoryboardPanel {
  const panel = asObject(rawPanel);
  if (!panel) {
    throw new Error(`Panel ${index + 1} is not an object.`);
  }

  const panelTypeRaw = asString(panel.panelType);
  const panelType: PanelTypeValue = panelTypeRaw === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
  const characterAction = asString(panel.characterAction);
  const environment = asString(panel.environment);
  const cameraDirection = asString(panel.cameraDirection);
  const productPlacement = asString(panel.productPlacement);
  const transitionType = asString(panel.transitionType);
  if (!cameraDirection || !productPlacement || !transitionType) {
    throw new Error(`Panel ${index + 1} is missing required visual fields.`);
  }
  if (panelType === "ON_CAMERA" && !characterAction) {
    throw new Error(`Panel ${index + 1} is ON_CAMERA but missing characterAction.`);
  }

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
    bRollSuggestions: asStringArray(panel.bRollSuggestions),
    transitionType,
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

  const beatCountFromRaw = normalizePositiveInt(root.beatCount, scenesRaw.length);
  const beatCount = beatCountFromRaw === scenesRaw.length ? beatCountFromRaw : scenesRaw.length;
  const targetDuration = normalizePositiveInt(root.targetDuration, 30);
  const fallbackSecondsPerBeat = targetDuration / beatCount;

  const beats = scenesRaw.map((scene, index) => {
    const sceneObj = asObject(scene) ?? {};
    const label = asString(sceneObj.beat) || `Beat ${index + 1}`;
    const vo = asString(sceneObj.vo) || "";
    const durationParsed = parseDurationRange(
      typeof sceneObj.duration === "string" || typeof sceneObj.duration === "number"
        ? sceneObj.duration
        : null,
    );

    const fallbackStart = fallbackSecondsPerBeat * index;
    const fallbackEnd = index === beatCount - 1 ? targetDuration : fallbackStart + fallbackSecondsPerBeat;
    const start = durationParsed?.start ?? fallbackStart;
    const end = durationParsed?.end ?? fallbackEnd;

    return {
      beatLabel: label,
      startTime: `${formatSeconds(start)}s`,
      endTime: `${formatSeconds(end)}s`,
      vo,
    };
  });

  const soraScenes = beats.flatMap((beat) => {
    const start = parseFloat(beat.startTime);
    const end = parseFloat(beat.endTime);
    return splitBeatIntoClips({ ...beat, durationSeconds: end - start });
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
  } = args;
  const beatLines = beats
    .map(
      (beat, index) =>
        `- Beat ${index + 1}: ${beat.beatLabel} (${beat.startTime}-${beat.endTime}) | VO: "${beat.vo}"`
    )
    .join("\n");
  const overlayPatternLower = textOverlayPattern.toLowerCase();
  const requiresSingleKeywordAtPeaks =
    (overlayPatternLower.includes("single keyword") ||
      overlayPatternLower.includes("single-word") ||
      overlayPatternLower.includes("single word")) &&
    (overlayPatternLower.includes("emotional peak") || overlayPatternLower.includes("emotional peaks"));
  const singleKeywordRule = requiresSingleKeywordAtPeaks
    ? "If the pattern says single keywords at emotional peaks, every panel must include exact single-keyword overlay copy with explicit peak timing."
    : "";

  return `TIER 1 - STRUCTURE (NON-NEGOTIABLE)
targetDuration: ${targetDuration}
beatCount: ${beatCount}
scriptBeatsWithExactVO:
${beatLines}
Panel count must equal beat count. Timing must match script exactly.

TIER 2 - QUALITY GATES (GO/NO-GO)
- Product placement must include exact timing in each panel.
- Text overlay pattern must include exact timing and exact copy in each panel.
- Character action must be authentic and specific; no generic descriptions.
- Panel type decision: If the beat content is pure product demonstration, visual metaphor, or montage that doesn't require the creator speaking directly to camera, set panelType to B_ROLL_ONLY. When B_ROLL_ONLY, characterAction can be null and bRollSuggestions becomes the primary direction with shot-by-shot breakdown.
Text overlay pattern:
${textOverlayPattern}
Use explicit timing format in bRollSuggestions: TEXT OVERLAY 12.0s-13.5s: COPY
${singleKeywordRule}

TIER 3 - GUIDANCE (INFORM DON'T DICTATE)
environmentContext:
- lifeStage: ${lifeStage || "MISSING"}
- buyTriggerSituation: ${buyTriggerSituation || "MISSING"}
mechanismProcess: ${mechanismProcess || "MISSING"}
visualFlowPattern: ${visualFlowPattern || "MISSING"}
creatorReferenceImageUrl: ${creatorReferenceImageUrl || "MISSING"}
productReferenceImageUrl: ${productReferenceImageUrl || "MISSING"}
Use Tier 3 for creative decisions. Don't force it if the shot doesn't support it.
If reference image URLs are present, keep subject/product appearance consistent with them.

Output JSON schema:
{
  "panels": [
    {
      "panelType": "ON_CAMERA | B_ROLL_ONLY",
      "beatLabel": "string",
      "startTime": "string",
      "endTime": "string",
      "vo": "string copied from script",
      "characterAction": "string | null",
      "environment": "string | null",
      "cameraDirection": "string",
      "productPlacement": "string",
      "bRollSuggestions": ["string"],
      "transitionType": "string"
    }
  ]
}

Return ONLY valid JSON.`;
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
  opts?: { productId?: string | null; characterHandle?: string | null },
): Promise<{
  storyboardId: string;
  panelCount: number;
  targetDuration: number;
  validationReport: StoryboardValidationReport;
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

  const { beatCount, targetDuration, beats } = buildBeatSpecsFromScript(script.rawJson);
  if (!beats.length) {
    throw new Error("Script scenes are empty; cannot generate storyboard.");
  }

  const anthropicApiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const anthropic = new Anthropic({
    apiKey: anthropicApiKey,
    timeout: 90_000,
  });

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

  const panels = panelsRaw.map((panel, index) =>
    validatePanel(panel, beats[index] ?? beats[beats.length - 1], index),
  );
  const validationReport = validateStoryboardAgainstGates(panels);
  console.log("[storyboardGeneration] Validation report:", validationReport);

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
    validationReport,
  };
}
