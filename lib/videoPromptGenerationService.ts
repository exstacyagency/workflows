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

const VIDEO_PROMPT_SYSTEM_PROMPT =
  "You write Kling AI video prompts. Translate storyboard direction into camera-ready prompts under 200 characters. Be specific. Every word earns its place.";

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
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 200) return normalized;
  return normalized.slice(0, 200).trimEnd();
}

function formatDurationLabel(durationSec: number): string {
  const rounded = Number.isFinite(durationSec) ? Math.round(durationSec * 10) / 10 : 8;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function buildVideoPromptUserPrompt(args: {
  sceneNumber: number;
  durationSec: number;
  vo: string;
  panelType: PanelType;
  characterAction: string | null;
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
    panelType,
    characterAction,
    environment,
    cameraDirection,
    productPlacement,
    bRollSuggestions,
    hasCreatorRef,
    hasProductRef,
  } = args;

  return `Scene ${sceneNumber}, ${formatDurationLabel(durationSec)}s.

VO: ${vo || 'N/A'}

Panel type: ${panelType}

Character: ${characterAction || 'N/A'}
Environment: ${environment || 'N/A'}
Camera: ${cameraDirection || 'N/A'}
Product placement: ${productPlacement || 'N/A'}
B-roll shots: ${bRollSuggestions.length > 0 ? bRollSuggestions.join('; ') : 'N/A'}

${hasCreatorRef ? 'Subject from creator reference image.' : ''}
${hasProductRef ? 'Product from product reference image.' : ''}

Write a Kling prompt. Specify subject, exact action with timing, camera movement, lighting. Under 200 chars. No fluff.`;
}

async function generateKlingPromptWithClaude(args: {
  sceneNumber: number;
  durationSec: number;
  vo: string;
  panelType: PanelType;
  characterAction: string | null;
  environment: string | null;
  cameraDirection: string;
  productPlacement: string;
  bRollSuggestions: string[];
  hasCreatorRef: boolean;
  hasProductRef: boolean;
  fallbackPrompt: string;
}): Promise<string> {
  const apiKey = cfg.raw("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.warn("[videoPromptGeneration] Missing ANTHROPIC_API_KEY; using fallback prompt template.");
    return normalizeKlingPrompt(args.fallbackPrompt);
  }

  const anthropic = new Anthropic({
    apiKey,
    timeout: 60000,
  });

  const userPrompt = buildVideoPromptUserPrompt({
    sceneNumber: args.sceneNumber,
    durationSec: args.durationSec,
    vo: args.vo,
    panelType: args.panelType,
    characterAction: args.characterAction,
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
      max_tokens: 200,
      system: VIDEO_PROMPT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = extractTextContent(response);
    if (!text) {
      throw new Error("Claude returned empty video prompt text");
    }
    const prompt = normalizeKlingPrompt(text);
    console.log(`[videoPromptGeneration] Generated prompt for scene ${args.sceneNumber}`, {
      prompt,
    });
    return prompt;
  } catch (error: any) {
    console.error("[videoPromptGeneration] Claude prompt generation failed; using fallback template.", {
      sceneNumber: args.sceneNumber,
      error: String(error?.message ?? error),
    });
    const prompt = normalizeKlingPrompt(args.fallbackPrompt);
    console.log(`[videoPromptGeneration] Generated prompt for scene ${args.sceneNumber}`, {
      prompt,
    });
    return prompt;
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
 * Build a per-scene video prompt.
 *
 * Mirrors the intent of your n8n "Generate Video Prompt":
 * - Use duration
 * - Use motion arc (if present in rawJson)
 * - Emphasize smooth interpolation + character consistency
 * - Use first/last frame as anchors (implicitly via narrative)
 */
function buildVideoPromptForScene(opts: {
  sceneNumber: number;
  durationSec: number;
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
  raw: any;
  panelType: PanelType;
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
}): string {
  const {
    sceneNumber,
    durationSec,
    firstFrameUrl,
    lastFrameUrl,
    raw,
    panelType,
    creatorReferenceImageUrl,
    productReferenceImageUrl,
  } = opts;

  const motionArc: string =
    raw?.motion_arc ||
    `Smooth movement from first frame to last frame for scene ${sceneNumber}`;

  const referencesInfo = [
    panelType !== 'B_ROLL_ONLY' && creatorReferenceImageUrl
      ? 'Keep the subject from creator reference image consistent across the scene.'
      : null,
    productReferenceImageUrl
      ? 'Show the product from product reference image with matching appearance and branding.'
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const framesInfo = [
    firstFrameUrl ? `First frame: ${firstFrameUrl}` : null,
    lastFrameUrl ? `Last frame: ${lastFrameUrl}` : null,
    creatorReferenceImageUrl ? `Creator reference image: ${creatorReferenceImageUrl}` : null,
    productReferenceImageUrl ? `Product reference image: ${productReferenceImageUrl}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return `${durationSec}s. ${motionArc}. Maintain character consistency between first and last frame. Smooth interpolation between poses. ${referencesInfo} ${framesInfo}`
    .trim();
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
    const sceneReferenceFrames = buildSceneReferenceFrames({
      panelType,
      creatorReferenceImageUrl,
      productReferenceImageUrl,
    });

    const fallbackPrompt = buildVideoPromptForScene({
      sceneNumber: 1,
      durationSec: 8,
      raw: {},
      panelType,
      creatorReferenceImageUrl:
        sceneReferenceFrames.find((frame) => frame.kind === 'creator')?.url ?? null,
      productReferenceImageUrl:
        sceneReferenceFrames.find((frame) => frame.kind === 'product')?.url ?? null,
    });
    const prompt = await generateKlingPromptWithClaude({
      sceneNumber: 1,
      durationSec: 8,
      vo: "",
      panelType,
      characterAction: null,
      environment: null,
      cameraDirection: "",
      productPlacement: "",
      bRollSuggestions: [],
      hasCreatorRef: Boolean(sceneReferenceFrames.find((frame) => frame.kind === 'creator')?.url),
      hasProductRef: Boolean(sceneReferenceFrames.find((frame) => frame.kind === 'product')?.url),
      fallbackPrompt,
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

  const targetScenes = scenes.filter(
    (s: any) => {
      const vp = (s as any).videoPrompt ?? (s.rawJson as any)?.videoPrompt ?? '';
      return !vp || String(vp).trim().length === 0;
    },
  );

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
    const characterAction = asString(raw.characterAction) || null;
    const environment = asString(raw.environment) || null;
    const cameraDirection = asString(raw.cameraDirection);
    const productPlacement = asString(raw.productPlacement);
    const bRollSuggestions = asStringArray(raw.bRollSuggestions);

    const fallbackPrompt = buildVideoPromptForScene({
      sceneNumber,
      durationSec,
      firstFrameUrl,
      lastFrameUrl,
      raw,
      panelType,
      creatorReferenceImageUrl: sceneCreatorReferenceImageUrl,
      productReferenceImageUrl: sceneProductReferenceImageUrl,
    });
    const prompt = await generateKlingPromptWithClaude({
      sceneNumber,
      durationSec,
      vo,
      panelType,
      characterAction,
      environment,
      cameraDirection,
      productPlacement,
      bRollSuggestions,
      hasCreatorRef: Boolean(sceneCreatorReferenceImageUrl),
      hasProductRef: Boolean(sceneProductReferenceImageUrl),
      fallbackPrompt,
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
