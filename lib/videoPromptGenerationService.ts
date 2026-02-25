// lib/videoPromptGenerationService.ts
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import {
  assertProductSetupReferenceReachable,
  assertProductSetupReferenceUrl,
} from "@/lib/productSetupReferencePolicy";
import prisma from '@/lib/prisma';
import { JobStatus, PanelType } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';

type SceneReferenceFrame = {
  kind: 'creator' | 'product';
  role: 'subject' | 'product';
  url: string;
};

const VIDEO_PROMPT_SYSTEM_PROMPT = `You are a Sora 2 API generating UGC ad video prompts. Output ONLY the prompt text. No preamble, no explanation, no markdown.

VISUAL IDENTITY (apply to every scene):
- Shot on iPhone 15 Pro front camera, ~24mm equivalent, vertical 9:16
- Handheld selfie grip with micro-jitter and subtle sway
- Shallow depth of field, soft background blur
- Natural phone grain, slight exposure variation, no filters
- Single-take aesthetic - no cuts, no transitions within clip
- Audio: iPhone mic, slight room reverb, ambient background noise, NO music

CHARACTER CONSISTENCY:
- CHARACTER ANCHOR overrides all other character instructions when present
- Match the anchor description exactly - face, hair, skin, clothing, age
- If no anchor provided, maintain consistent identity across scenes`;

const VIDEO_PROMPT_MODEL = cfg.raw("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter(Boolean);
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadProductReferenceImages(args: {
  projectId: string;
  productId: string | null;
}): Promise<{
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
}> {
  if (!args.productId) {
    return {
      creatorReferenceImageUrl: null,
      productReferenceImageUrl: null,
    };
  }

  const productRows = await prisma.$queryRaw<Array<{
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
  const creatorReferenceImageUrl = normalizeUrl(productRows[0]?.creatorReferenceImageUrl);
  const productReferenceImageUrl = normalizeUrl(productRows[0]?.productReferenceImageUrl);

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
  };
}

function resolvePanelType(raw: any, panelType: unknown): PanelType {
  if (raw?.panelType === 'B_ROLL_ONLY' || panelType === 'B_ROLL_ONLY') {
    return 'B_ROLL_ONLY';
  }
  return 'ON_CAMERA';
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

function normalizeKlingPrompt(text: string): string {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (normalized.length <= 2400) return normalized;
  return normalized.slice(0, 2400).trimEnd();
}

function normalizeForMatch(value: string): string {
  return String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ensurePromptContainsVo(prompt: string, requiredVo: string): string {
  const nextPrompt = String(prompt ?? "").trim();
  const vo = String(requiredVo ?? "").trim();
  if (!vo) return nextPrompt;

  const promptMatch = normalizeForMatch(nextPrompt);
  const voMatch = normalizeForMatch(vo);
  if (voMatch && promptMatch.includes(voMatch)) {
    return nextPrompt;
  }

  return `${nextPrompt}\n\nVO line: "${vo}"`.trim();
}

function ensurePromptContainsCharacterHandle(prompt: string, characterHandle: string | null): string {
  const nextPrompt = String(prompt ?? "").trim();
  const normalizedHandle = normalizeCharacterHandleForPrompt(characterHandle);
  if (!normalizedHandle) return nextPrompt;

  const promptMatch = normalizeForMatch(nextPrompt);
  const handleMatch = normalizeForMatch(normalizedHandle);
  if (handleMatch && promptMatch.includes(handleMatch)) {
    return nextPrompt;
  }

  return `${nextPrompt}\n\nCharacter handle: ${normalizedHandle}`.trim();
}

function ensurePromptStatesOffCameraVoice(prompt: string, panelType: PanelType): string {
  const nextPrompt = String(prompt ?? "").trim();
  if (panelType !== "B_ROLL_ONLY") return nextPrompt;

  const requiredLine = "Creator is speaking but is not shown.";
  const promptMatch = normalizeForMatch(nextPrompt);
  const requiredMatch = normalizeForMatch(requiredLine);
  if (requiredMatch && promptMatch.includes(requiredMatch)) {
    return nextPrompt;
  }

  return `${nextPrompt}\n\n${requiredLine}`.trim();
}

function formatDurationLabel(durationSec: number): string {
  const rounded = Number.isFinite(durationSec) ? Math.round(durationSec * 10) / 10 : 8;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function normalizeCharacterHandleForPrompt(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return `@${raw.replace(/^@+/, "")}`;
}

function buildVideoPromptUserPrompt(args: {
  sceneNumber: number;
  totalScenes: number;
  durationSec: number;
  vo: string;
  scriptVoFull: string | null;
  scriptBeat: { beat?: string; duration?: string; vo?: string } | null;
  panelType: PanelType;
  characterAction: string | null;
  characterHandle: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  characterAnchor: string | null;
  characterDescription: string;
  hasCreatorRef: boolean;
  hasProductRef: boolean;
}): string {
  const {
    sceneNumber,
    totalScenes,
    durationSec,
    vo,
    scriptVoFull,
    scriptBeat,
    panelType,
    characterAction,
    characterHandle,
    environment,
    cameraDirection,
    productPlacement,
    bRollSuggestions,
    characterAnchor,
    characterDescription,
    hasCreatorRef,
    hasProductRef,
  } = args;
  const normalizedCharacterHandle = normalizeCharacterHandleForPrompt(characterHandle);
  const beatLabel = asString(scriptBeat?.beat);

  return `SCENE ${sceneNumber} of ${totalScenes} | ${formatDurationLabel(durationSec)}s | ${panelType}
${beatLabel ? `Beat: ${beatLabel}` : ""}

FULL AD VO (for context only):
"${scriptVoFull || "N/A"}"

THIS SCENE VO (include verbatim):
"${vo || "N/A"}"

STORYBOARD DIRECTION:
SET DRESSING (render these props explicitly):
${environment || "real home/work setting, lived-in and natural"}
Camera: ${cameraDirection || "medium close-up, eye level, centered"}
Character action: ${characterAction || "N/A"}
Product placement: ${productPlacement || "none"}
${bRollSuggestions.length > 0 ? `B-roll overlays: ${bRollSuggestions.join("; ")}` : ""}
${normalizedCharacterHandle ? `Character handle: ${normalizedCharacterHandle} (include verbatim with @ symbol)` : ""}
${hasCreatorRef ? "Subject: match creator reference image exactly." : ""}
${hasProductRef ? "Product: match product reference image exactly." : ""}

CHARACTER ANCHOR (non-negotiable, apply exactly):
${characterAnchor || characterDescription}

OUTPUT STRUCTURE - use these exact labels:

[Scene: one sentence - subject, environment, atmosphere]

Environment:
- [specific props and set dressing visible in frame]
- [room details - walls, surfaces, lighting fixtures]

Cinematography:
- Shot: [framing, angle, distance]
- Lighting: [source, quality, temperature]
- Palette: [3-5 color anchors]
- Motion: [camera movement, handheld behavior]

Performance:
- 0s: [opening action]
- ${Math.round(durationSec * 0.3)}s: [mid action]
- ${Math.round(durationSec * 0.7)}s: [product/key moment]
- ${formatDurationLabel(durationSec)}s: [closing action]

VO: "${vo || "N/A"}"

Audio:
- [ambient sound description]
- No music. iPhone mic. Single-take.

UGC keywords: smartphone selfie, handheld realism, front-camera authenticity, raw UGC monologue, micro-jitters, imperfect framing, no filters, one-take aesthetic, subtle exposure shifts.

CONSTRAINTS:
- Vertical 9:16 format
- ${formatDurationLabel(durationSec)}s clip duration
- Include scene VO verbatim
- No cinematic film language - this is a phone video`;
}

async function generateKlingPromptWithClaude(args: {
  sceneNumber: number;
  totalScenes: number;
  durationSec: number;
  vo: string;
  requiredVo: string;
  scriptVoFull: string | null;
  scriptBeat: { beat?: string; duration?: string; vo?: string } | null;
  panelType: PanelType;
  characterAction: string | null;
  characterHandle: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  characterAnchor: string | null;
  characterDescription: string;
  hasCreatorRef: boolean;
  hasProductRef: boolean;
}): Promise<string> {
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: 60000,
  });

  const userPrompt = buildVideoPromptUserPrompt({
    sceneNumber: args.sceneNumber,
    totalScenes: args.totalScenes,
    durationSec: args.durationSec,
    vo: args.requiredVo,
    scriptVoFull: args.scriptVoFull ?? null,
    scriptBeat: args.scriptBeat ?? null,
    panelType: args.panelType,
    characterAction: args.characterAction,
    characterHandle: args.characterHandle ?? null,
    environment: args.environment,
    cameraDirection: args.cameraDirection,
    productPlacement: args.productPlacement,
    bRollSuggestions: args.bRollSuggestions,
    characterAnchor: args.characterAnchor,
    characterDescription: args.characterDescription,
    hasCreatorRef: args.hasCreatorRef,
    hasProductRef: args.hasProductRef,
  });

  try {
    const response = await anthropic.messages.create({
      model: VIDEO_PROMPT_MODEL,
      max_tokens: 2400,
      system: VIDEO_PROMPT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = extractTextContent(response);
    if (!text) {
      throw new Error("Claude returned empty video prompt text");
    }
    const prompt = normalizeKlingPrompt(text);
    const promptWithVo = ensurePromptContainsVo(prompt, args.requiredVo);
    const promptWithHandle = ensurePromptContainsCharacterHandle(
      promptWithVo,
      args.characterHandle ?? null,
    );
    const promptWithVoiceVisibility = ensurePromptStatesOffCameraVoice(
      promptWithHandle,
      args.panelType,
    );
    console.log(`[videoPromptGeneration] Generated prompt for scene ${args.sceneNumber}`, {
      prompt: promptWithVoiceVisibility,
    });
    return promptWithVoiceVisibility;
  } catch (error: any) {
    console.error("[videoPromptGeneration] Claude prompt generation failed.", {
      sceneNumber: args.sceneNumber,
      error: String(error?.message ?? error),
    });
    throw error;
  }
}

function buildSceneReferenceFrames(args: {
  panelType: PanelType;
  creatorReferenceImageUrl: string | null;
  productReferenceImageUrl: string | null;
}): SceneReferenceFrame[] {
  const frames: SceneReferenceFrame[] = [];

  if (args.panelType !== 'B_ROLL_ONLY' && args.creatorReferenceImageUrl) {
    frames.push({
      kind: 'creator',
      role: 'subject',
      url: args.creatorReferenceImageUrl,
    });
  }

  if (args.productReferenceImageUrl) {
    frames.push({
      kind: 'product',
      role: 'product',
      url: args.productReferenceImageUrl,
    });
  }

  return frames;
}

/**
 * Generate video prompts for all scenes in a storyboard that:
 * - have firstFrameUrl and lastFrameUrl
 * - do NOT have videoPrompt yet
 */
export async function runVideoPromptGeneration(args: {
  storyboardId: string;
  jobId?: string;
  productId?: string | null;
  characterHandle?: string | null;
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
}) {
  const { storyboardId } = args;
  console.log("[videoPromptGeneration] Starting prompt generation for storyboard ID", {
    storyboardId,
  });

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: {
      scenes: true,
      script: {
        select: {
          rawJson: true,
          job: {
            select: {
              payload: true,
            },
          },
        },
      },
    },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  console.log('[videoPromptGeneration] Loaded storyboard scenes', {
    storyboardId,
    sceneCount: storyboard.scenes.length,
    sceneIds: storyboard.scenes.map((scene) => scene.id),
  });

  const scriptJobPayload = asObject(storyboard.script?.job?.payload) ?? {};
  const scriptRaw = (storyboard.script?.rawJson ?? {}) as any;
  const scriptVoFull = asString(scriptRaw.vo_full) || null;
  const scriptScenes = Array.isArray(scriptRaw.scenes) ? scriptRaw.scenes : [];
  const handleFromScriptPayload = asString((scriptJobPayload as any).characterHandle) || null;
  const handleFromStoryboardScenes =
    storyboard.scenes
      .map((scene) => {
        const raw = asObject((scene as any).rawJson);
        return asString((raw as any).characterHandle);
      })
      .find((value) => value.length > 0) || null;
  const globalCharacterHandle = normalizeCharacterHandleForPrompt(
    args.characterHandle ?? handleFromScriptPayload ?? handleFromStoryboardScenes ?? null,
  );
  const effectiveProductId =
    normalizeUrl(args.productId) ||
    normalizeUrl(scriptJobPayload.productId) ||
    null;
  const productReferenceImages = await loadProductReferenceImages({
    projectId: storyboard.projectId,
    productId: effectiveProductId,
  });

  const creatorReferenceImageUrl = normalizeUrl(
    args.creatorReferenceImageUrl ?? productReferenceImages.creatorReferenceImageUrl,
  );
  const productReferenceImageUrl = normalizeUrl(
    args.productReferenceImageUrl ?? productReferenceImages.productReferenceImageUrl,
  );

  let scenes = storyboard.scenes;
  let processed = 0;

  if (scenes.length === 0) {
    const panelType: PanelType = 'ON_CAMERA';
    const fallbackSceneBeatRaw = asObject(scriptScenes[0]) ?? null;
    const fallbackSceneBeat: { beat?: string; duration?: string; vo?: string } | null =
      fallbackSceneBeatRaw
        ? {
            beat: asString(fallbackSceneBeatRaw.beat) || undefined,
            duration: asString(fallbackSceneBeatRaw.duration) || undefined,
            vo: asString(fallbackSceneBeatRaw.vo) || undefined,
          }
        : null;
    const fallbackRequiredVo = asString(fallbackSceneBeat?.vo);
    if (!fallbackRequiredVo) {
      throw new Error("Scene 1 missing VO. Cannot generate video prompt without scene VO.");
    }
    const sceneReferenceFrames = buildSceneReferenceFrames({
      panelType,
      creatorReferenceImageUrl,
      productReferenceImageUrl,
    });

    const prompt = await generateKlingPromptWithClaude({
      sceneNumber: 1,
      totalScenes: 1,
      durationSec: 8,
      vo: "",
      requiredVo: fallbackRequiredVo,
      scriptVoFull,
      scriptBeat: fallbackSceneBeat,
      panelType,
      characterAction: null,
      characterHandle: globalCharacterHandle,
      environment: null,
      cameraDirection: "",
      productPlacement: "",
      bRollSuggestions: [],
      characterAnchor: null,
      characterDescription: "Same creator identity as the ad context. Maintain face, hair, clothing, and age consistency.",
      hasCreatorRef: Boolean(sceneReferenceFrames.find((frame) => frame.kind === 'creator')?.url),
      hasProductRef: Boolean(sceneReferenceFrames.find((frame) => frame.kind === 'product')?.url),
    });

    const created = await prisma.storyboardScene.create({
      data: {
        storyboardId,
        sceneNumber: 1,
        rawJson: {
          durationSec: 8,
          aspectRatio: '9:16',
          sceneFull: '',
          videoPrompt: prompt,
          panelType,
          creatorReferenceImageUrl:
            sceneReferenceFrames.find((frame) => frame.kind === 'creator')?.url ?? null,
          productReferenceImageUrl:
            sceneReferenceFrames.find((frame) => frame.kind === 'product')?.url ?? null,
          referenceFrames: sceneReferenceFrames,
        } as any,
        status: 'pending',
      },
    });
    scenes = [created];
    processed = 1;
  }

  const targetScenes = scenes;
  const totalScenes = targetScenes.length;

  if (!targetScenes.length) {
    console.log("[videoPromptGeneration] All prompts generated successfully", {
      storyboardId,
      totalCount: processed,
    });
    return {
      ok: true,
      storyboardId,
      sceneCount: scenes.length,
      processed,
    };
  }

  for (const scene of targetScenes) {
    const raw = (scene.rawJson ?? {}) as any;
    const sceneNumber = (scene as any).sceneNumber ?? raw.sceneNumber ?? 1;
    const durationSec = (scene as any).durationSec ?? raw.durationSec ?? 8;
    const firstFrameUrl = (scene as any).firstFrameUrl ?? raw.firstFrameUrl ?? raw.first_frame_url ?? null;
    const lastFrameUrl = (scene as any).lastFrameUrl ?? raw.lastFrameUrl ?? raw.last_frame_url ?? null;
    const panelType = resolvePanelType(raw, (scene as any).panelType);

    const sceneReferenceFrames = buildSceneReferenceFrames({
      panelType,
      creatorReferenceImageUrl,
      productReferenceImageUrl,
    });
    const sceneCreatorReferenceImageUrl =
      sceneReferenceFrames.find((frame) => frame.kind === 'creator')?.url ?? null;
    const sceneProductReferenceImageUrl =
      sceneReferenceFrames.find((frame) => frame.kind === 'product')?.url ?? null;

    const vo = asString(raw.vo);
    const sceneBeatRaw = asObject(scriptScenes[sceneNumber - 1]) ?? null;
    const sceneBeat: { beat?: string; duration?: string; vo?: string } | null = sceneBeatRaw
      ? {
          beat: asString(sceneBeatRaw.beat) || undefined,
          duration: asString(sceneBeatRaw.duration) || undefined,
          vo: asString(sceneBeatRaw.vo) || undefined,
        }
      : null;
    const sceneBeatVo = asString(sceneBeat?.vo);
    const requiredVo = vo || sceneBeatVo;
    if (!requiredVo) {
      throw new Error(`Scene ${sceneNumber} missing VO. Cannot generate video prompt without scene VO.`);
    }
    const characterAction = asString(raw.characterAction) || null;
    const characterHandle = asString((raw as any).characterHandle) || globalCharacterHandle || null;
    const environment = asString(raw.environment) || null;
    const cameraDirection = asString(raw.cameraDirection);
    const productPlacement = asString(raw.productPlacement);
    const bRollSuggestions = asStringArray(raw.bRollSuggestions);
    const characterDescription =
      asString((raw as any).characterDescription) ||
      (characterHandle
        ? `Creator handle ${normalizeCharacterHandleForPrompt(characterHandle)}. Keep identity and styling consistent across scenes.`
        : "Same creator identity across scenes. Keep face, hair, clothing, and age consistent.");
    const characterAnchor = asString((raw as any).characterAnchor) || null;

    const prompt = await generateKlingPromptWithClaude({
      sceneNumber,
      totalScenes,
      durationSec,
      vo,
      requiredVo,
      scriptVoFull,
      scriptBeat: sceneBeat,
      panelType,
      characterAction,
      characterHandle,
      environment,
      cameraDirection,
      productPlacement,
      bRollSuggestions,
      characterAnchor,
      characterDescription,
      hasCreatorRef: Boolean(sceneCreatorReferenceImageUrl),
      hasProductRef: Boolean(sceneProductReferenceImageUrl),
    });
    console.log('[videoPromptGeneration] Claude prompt generated', {
      storyboardId,
      sceneNumber,
      prompt,
    });

    const hasFrames = Boolean(firstFrameUrl && lastFrameUrl);
    const nextStatus = hasFrames
      ? ((scene as any).status === 'frames_ready' || (scene as any).status === 'pending'
          ? 'prompt_ready'
          : (scene as any).status)
      : (scene as any).status || 'pending';

    const rawForUpdate = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    rawForUpdate.videoPrompt = prompt;
    rawForUpdate.panelType = panelType;
    rawForUpdate.creatorReferenceImageUrl = sceneCreatorReferenceImageUrl;
    rawForUpdate.productReferenceImageUrl = sceneProductReferenceImageUrl;
    rawForUpdate.referenceFrames = sceneReferenceFrames;

    try {
      await prisma.storyboardScene.update({
        where: { id: scene.id },
        data: {
          status: nextStatus,
          rawJson: rawForUpdate,
        },
      });
      console.log('[videoPromptGeneration] Scene update result', {
        storyboardId,
        sceneId: scene.id,
        writeSucceeded: true,
      });
    } catch (error: any) {
      console.error('[videoPromptGeneration] Scene update result', {
        storyboardId,
        sceneId: scene.id,
        writeSucceeded: false,
        error: String(error?.message ?? error),
      });
      throw error;
    }

    processed += 1;
  }

  console.log("[videoPromptGeneration] All prompts generated successfully", {
    storyboardId,
    totalCount: processed,
  });
  return {
    ok: true,
    storyboardId,
    sceneCount: scenes.length,
    processed,
  };
}

/**
 * Convenience wrapper: Job for video prompt generation.
 */
export async function startVideoPromptGenerationJob(params: {
  storyboardId: string;
  jobId: string;
  productId?: string | null;
  characterHandle?: string | null;
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
}) {
  const {
    storyboardId,
    jobId,
    productId,
    characterHandle,
    creatorReferenceImageUrl,
    productReferenceImageUrl,
  } = params;
  const existingJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!existingJob) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (existingJob.status === JobStatus.RUNNING) {
    console.warn(
      `[videoPromptGeneration] Job ${jobId} already RUNNING; skipping duplicate RUNNING transition.`,
    );
  } else {
    await updateJobStatus(jobId, JobStatus.RUNNING);
  }

  try {
    const result = await runVideoPromptGeneration({
      storyboardId,
      jobId,
      productId,
      characterHandle,
      creatorReferenceImageUrl,
      productReferenceImageUrl,
    });

    await updateJobStatus(jobId, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultSummary: `Video prompts generated: ${result.processed}/${result.sceneCount} scenes`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await updateJobStatus(jobId, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        error: err?.message ?? 'Unknown error during video prompt generation',
      },
    });

    throw err;
  }
}
