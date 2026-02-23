// lib/videoPromptGenerationService.ts
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "@/lib/config";
import prisma from '@/lib/prisma';
import { JobStatus, PanelType } from '@prisma/client';
import { updateJobStatus } from '@/lib/jobs/updateJobStatus';

type SceneReferenceFrame = {
  kind: 'creator' | 'product';
  role: 'subject' | 'product';
  url: string;
};

const VIDEO_PROMPT_SYSTEM_PROMPT = `You are a video director writing production-grade Sora 2 prompts for UGC supplement ads.
Return only the final prompt text.
Write clear cinematic direction with concrete subject action, camera language, lighting, and environment details.
Keep temporal continuity and character consistency across the shot.
If a character handle is provided, include it verbatim with the @ symbol.
VO IS MANDATORY: include the scene's VO line verbatim in every output prompt (as a VO line or spoken line).`;

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
  return {
    creatorReferenceImageUrl: normalizeUrl(productRows[0]?.creatorReferenceImageUrl),
    productReferenceImageUrl: normalizeUrl(productRows[0]?.productReferenceImageUrl),
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
  hasCreatorRef: boolean;
  hasProductRef: boolean;
}): string {
  const {
    sceneNumber,
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
    hasCreatorRef,
    hasProductRef,
  } = args;
  const normalizedCharacterHandle = normalizeCharacterHandleForPrompt(characterHandle);
  const beatLabel = scriptBeat
    ? `${asString(scriptBeat.beat) || "N/A"} (${asString(scriptBeat.duration) || "N/A"}) - VO: "${asString(scriptBeat.vo) || "N/A"}"`
    : "";

  return `You are generating a Sora 2 video prompt for Scene ${sceneNumber} of a UGC supplement ad.

AD CONTEXT:
Full voiceover: "${scriptVoFull || 'N/A'}"
${beatLabel ? `This scene: ${beatLabel}` : ''}

STORYBOARD PANEL:
Scene ${sceneNumber} | ${formatDurationLabel(durationSec)}s | ${panelType}
Scene VO: ${vo || 'N/A'}
Character action: ${characterAction || 'N/A'}
${normalizedCharacterHandle ? `Character: ${normalizedCharacterHandle} (include verbatim)` : ''}
Environment: ${environment || 'N/A'}
Camera: ${cameraDirection || 'N/A'}
Product placement: ${productPlacement || 'N/A'}
${bRollSuggestions.length > 0 ? `B-roll: ${bRollSuggestions.join('; ')}` : ''}
${hasCreatorRef ? 'Subject: use creator reference image.' : ''}
${hasProductRef ? 'Product: use product reference image.' : ''}

Write a Sora 2 prompt using this structure and labels:

[Scene description: subject, environment, atmosphere]

Cinematography:
Camera shot: [framing and angle]
Lighting + palette: [light source, quality, 3-5 color anchors]
Mood: [tone]

Actions:
- [0s: opening beat]
- [Xs: next beat with timing]
- [Final beat]

Output requirements:
- 350-1200 characters
- No preamble or explanation
- Include concrete physical actions and camera movement
- Avoid generic filler phrasing
- MUST include this exact scene VO line verbatim somewhere in the output: "${vo || "N/A"}"`;
}

async function generateKlingPromptWithClaude(args: {
  sceneNumber: number;
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
    console.log(`[videoPromptGeneration] Generated prompt for scene ${args.sceneNumber}`, {
      prompt: promptWithVo,
    });
    return promptWithVo;
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
    const fallbackSceneBeat = asObject(scriptScenes[0]) ?? null;
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
      durationSec: 8,
      vo: "",
      requiredVo: fallbackRequiredVo,
      scriptVoFull,
      scriptBeat: fallbackSceneBeat,
      panelType,
      characterAction: null,
      characterHandle: null,
      environment: null,
      cameraDirection: "",
      productPlacement: "",
      bRollSuggestions: [],
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
    const sceneBeat = asObject(scriptScenes[sceneNumber - 1]) ?? null;
    const sceneBeatVo = asString(sceneBeat?.vo);
    const requiredVo = vo || sceneBeatVo;
    if (!requiredVo) {
      throw new Error(`Scene ${sceneNumber} missing VO. Cannot generate video prompt without scene VO.`);
    }
    const characterAction = asString(raw.characterAction) || null;
    const characterHandle = asString((raw as any).characterHandle) || null;
    const environment = asString(raw.environment) || null;
    const cameraDirection = asString(raw.cameraDirection);
    const productPlacement = asString(raw.productPlacement);
    const bRollSuggestions = asStringArray(raw.bRollSuggestions);

    const prompt = await generateKlingPromptWithClaude({
      sceneNumber,
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
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
}) {
  const {
    storyboardId,
    jobId,
    productId,
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
