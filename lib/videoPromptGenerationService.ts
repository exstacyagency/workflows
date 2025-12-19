// lib/videoPromptGenerationService.ts
import prisma from '@/lib/prisma';
import { JobStatus } from '@prisma/client';

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
}): string {
  const { sceneNumber, durationSec, firstFrameUrl, lastFrameUrl, raw } = opts;

  const motionArc: string =
    raw?.motion_arc ||
    `Smooth movement from first frame to last frame for scene ${sceneNumber}`;

  const framesInfo = [
    firstFrameUrl ? `First frame: ${firstFrameUrl}` : null,
    lastFrameUrl ? `Last frame: ${lastFrameUrl}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return `${durationSec}s. ${motionArc}. Maintain character consistency between first and last frame. Smooth interpolation between poses. ${framesInfo}`;
}

/**
 * Generate video prompts for all scenes in a storyboard that:
 * - have firstFrameUrl and lastFrameUrl
 * - do NOT have videoPrompt yet
 */
export async function runVideoPromptGeneration(args: {
  storyboardId: string;
  jobId?: string;
}) {
  const { storyboardId } = args;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: { scenes: true },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  let scenes = storyboard.scenes;
  let processed = 0;

  if (scenes.length === 0) {
    const prompt = buildVideoPromptForScene({
      sceneNumber: 1,
      durationSec: 8,
      raw: {},
    });
    const created = await prisma.storyboardScene.create({
      data: {
        storyboardId,
        sceneNumber: 1,
        durationSec: 8,
        aspectRatio: '9:16',
        sceneFull: '',
        rawJson: {},
        status: 'pending',
        videoPrompt: prompt,
      },
    });
    scenes = [created];
    processed = 1;
  }

  const targetScenes = scenes.filter(
    s => !s.videoPrompt || s.videoPrompt.trim().length === 0,
  );

  if (!targetScenes.length) {
    return {
      ok: true,
      storyboardId,
      sceneCount: scenes.length,
      processed,
    };
  }

  for (const scene of targetScenes) {
    const raw = (scene.rawJson ?? {}) as any;
    const prompt = buildVideoPromptForScene({
      sceneNumber: scene.sceneNumber,
      durationSec: scene.durationSec,
      firstFrameUrl: scene.firstFrameUrl,
      lastFrameUrl: scene.lastFrameUrl,
      raw,
    });

    const hasFrames = Boolean(scene.firstFrameUrl && scene.lastFrameUrl);
    const nextStatus = hasFrames
      ? (scene.status === 'frames_ready' || scene.status === 'pending'
          ? 'prompt_ready'
          : scene.status)
      : scene.status || 'pending';

    const updateData: Record<string, any> = {
      videoPrompt: prompt,
      status: nextStatus,
    };
    if (scene.rawJson == null) {
      updateData.rawJson = {};
    }

    await prisma.storyboardScene.update({
      where: { id: scene.id },
      data: updateData,
    });

    processed += 1;
  }

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
}) {
  const { storyboardId, jobId } = params;
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING },
  });
  try {
    const result = await runVideoPromptGeneration({
      storyboardId,
      jobId,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Video prompts generated: ${result.processed}/${result.sceneCount} scenes`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error during video prompt generation',
      },
    });

    throw err;
  }
}
