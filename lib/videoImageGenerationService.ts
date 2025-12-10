// lib/videoImageGenerationService.ts
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';

const KIE_BASE = process.env.KIE_API_BASE ?? 'https://api.kie.ai/api/v1';

function getKieHeaders() {
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) {
    throw new Error('KIE_API_KEY is not set');
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

type KieJobResponse = {
  data?: {
    state?: string; // e.g. "success", "ing", "error"
    resultJson?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

async function createKieImageJob(prompt: string, imageInputs: string[]): Promise<string> {
  const body = {
    model: 'google/nano-banana-pro',
    input: {
      prompt,
      image_input: imageInputs,
      aspect_ratio: '9:16',
      resolution: '2K',
      output_format: 'jpg',
    },
  };

  const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: getKieHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KIE createTask failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { data?: { taskId?: string } };
  const taskId = data?.data?.taskId;
  if (!taskId) {
    throw new Error('KIE createTask response missing taskId');
  }

  return taskId;
}

async function pollKieJob(taskId: string, maxTries = 20, delayMs = 30000): Promise<string[]> {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: getKieHeaders(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KIE recordInfo failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as KieJobResponse;
    const state = data?.data?.state;

    if (state === 'success') {
      const resultJson = data.data?.resultJson;
      if (!resultJson) {
        throw new Error('KIE success result missing resultJson');
      }
      const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
      const urls = parsed.resultUrls ?? [];
      if (!urls.length) {
        throw new Error('KIE success result has no resultUrls');
      }
      return urls;
    }

    if (state && state !== 'ing') {
      throw new Error(`KIE job ended with state=${state}`);
    }

    // Still running
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('KIE job did not complete in time');
}

/**
 * Generate first + last frame images for one storyboard scene.
 *
 * Assumes scene.rawJson contains:
 * - first_frame_prompt
 * - last_frame_prompt
 * - character_image_url
 * - environment_image_url
 * - product_image_url (optional)
 * - product_visible (boolean, optional)
 *
 * If those are missing, falls back to using scene.sceneFull as prompt.
 */
async function generateFramesForScene(sceneId: string) {
  const scene = await prisma.storyboardScene.findUnique({
    where: { id: sceneId },
  });

  if (!scene) return;

  // If frames already exist, skip
  if (scene.firstFrameUrl && scene.lastFrameUrl) {
    return;
  }

  const raw = (scene.rawJson ?? {}) as any;

  const firstPrompt: string =
    raw.first_frame_prompt || `First frame for scene ${scene.sceneNumber}:\n${scene.sceneFull}`;
  const lastPrompt: string =
    raw.last_frame_prompt || `Last frame for scene ${scene.sceneNumber}:\n${scene.sceneFull}`;

  const baseImages: string[] = [];

  if (raw.character_image_url) baseImages.push(String(raw.character_image_url));
  if (raw.environment_image_url) baseImages.push(String(raw.environment_image_url));

  if (raw.product_visible && raw.product_image_url) {
    baseImages.push(String(raw.product_image_url));
  }

  // FIRST FRAME
  const firstTaskId = await createKieImageJob(firstPrompt, baseImages);
  const firstUrls = await pollKieJob(firstTaskId);
  const firstFrameUrl = firstUrls[0];

  // LAST FRAME (include first frame as continuity reference)
  const lastImages = [...baseImages, firstFrameUrl];
  const lastTaskId = await createKieImageJob(lastPrompt, lastImages);
  const lastUrls = await pollKieJob(lastTaskId);
  const lastFrameUrl = lastUrls[0];

  await prisma.storyboardScene.update({
    where: { id: scene.id },
    data: {
      firstFrameUrl,
      lastFrameUrl,
      status: 'frames_ready',
    },
  });
}

/**
 * Orchestrator: generate images for all scenes in a storyboard that still need them.
 */
export async function runVideoImageGeneration(args: {
  storyboardId: string;
  jobId?: string;
}) {
  const { storyboardId } = args;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: {
      scenes: true,
    },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  const pendingScenes = storyboard.scenes.filter(
    s => !s.firstFrameUrl || !s.lastFrameUrl || s.status === 'pending',
  );

  if (!pendingScenes.length) {
    return {
      storyboardId,
      sceneCount: storyboard.scenes.length,
      processed: 0,
    };
  }

  let processed = 0;

  for (const s of pendingScenes) {
    try {
      await generateFramesForScene(s.id);
      processed += 1;
    } catch (err) {
      console.error(`Failed to generate frames for scene ${s.id}:`, err);
      // continue to next scene
    }
  }

  return {
    storyboardId,
    sceneCount: storyboard.scenes.length,
    processed,
  };
}

/**
 * Convenience wrapper: run video image generation as a Job.
 */
export async function startVideoImageGenerationJob(storyboardId: string) {
  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  const job = await prisma.job.create({
    data: {
      type: JobType.VIDEO_IMAGE_GENERATION,
      status: JobStatus.RUNNING,
      projectId: storyboard.projectId,
      payload: { storyboardId },
    },
  });

  try {
    const result = await runVideoImageGeneration({
      storyboardId,
      jobId: job.id,
    });

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Video image generation complete: ${result.processed}/${result.sceneCount} scenes processed`,
      },
    });

    return { jobId: job.id, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error during video image generation',
      },
    });

    throw err;
  }
}
