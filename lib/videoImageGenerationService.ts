// lib/videoImageGenerationService.ts
import prisma from '@/lib/prisma';
import { JobStatus } from '@prisma/client';
import { env, requireEnv } from './configGuard.ts';

const KIE_BASE = env('KIE_API_BASE') ?? 'https://api.kie.ai/api/v1';

function getKieHeaders() {
  requireEnv(['KIE_API_KEY'], 'KIE');
  const apiKey = env('KIE_API_KEY')!;
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

type SceneImageResult = {
  sceneId?: string;
  sceneNumber?: number | null;
  firstFrameUrl: string;
  lastFrameUrl: string;
  videoPrompt?: string | null;
};

type SceneLike = {
  id: string;
  sceneNumber: number;
  sceneFull: string;
  rawJson: unknown;
  videoPrompt: string | null;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  status: string;
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
async function generateFramesForScene(scene: SceneLike): Promise<SceneImageResult> {
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

  return {
    sceneId: scene.id,
    sceneNumber: scene.sceneNumber,
    firstFrameUrl,
    lastFrameUrl,
    videoPrompt: scene.videoPrompt,
  };
}

async function persistSceneImages(storyboardId: string, results: SceneImageResult[]) {
  if (results.length === 0) {
    return { scenesUpdated: 0 };
  }

  const scenes = await prisma.storyboardScene.findMany({
    where: { storyboardId },
  });

  const byId = new Map<string, SceneImageResult>();
  const byNumber = new Map<number, SceneImageResult>();
  for (const result of results) {
    if (result.sceneId) byId.set(result.sceneId, result);
    if (result.sceneNumber !== null && result.sceneNumber !== undefined) {
      byNumber.set(result.sceneNumber, result);
    }
  }

  const fallback = results[0];
  const useFallbackForAll = byNumber.size === 0;
  let scenesUpdated = 0;

  for (const scene of scenes) {
    let match =
      (scene.id ? byId.get(scene.id) : undefined) ??
      (scene.sceneNumber !== null && scene.sceneNumber !== undefined
        ? byNumber.get(scene.sceneNumber)
        : undefined);

    if (!match && useFallbackForAll) {
      match = fallback;
    }

    if (!match) continue;

    const nextStatus =
      scene.status === 'pending' || !scene.status ? 'frames_ready' : scene.status;

    const updateData: Record<string, any> = {};
    if (match.firstFrameUrl && match.firstFrameUrl !== scene.firstFrameUrl) {
      updateData.firstFrameUrl = match.firstFrameUrl;
    }
    if (match.lastFrameUrl && match.lastFrameUrl !== scene.lastFrameUrl) {
      updateData.lastFrameUrl = match.lastFrameUrl;
    }
    if (match.videoPrompt && match.videoPrompt !== scene.videoPrompt) {
      updateData.videoPrompt = match.videoPrompt;
    }
    if (nextStatus !== scene.status) {
      updateData.status = nextStatus;
    }

    if (Object.keys(updateData).length === 0) continue;

    await prisma.storyboardScene.update({
      where: { id: scene.id },
      data: updateData,
    });
    scenesUpdated += 1;
  }

  return { scenesUpdated };
}

/**
 * Orchestrator: generate images for all scenes in a storyboard that still need them.
 */
export async function runVideoImageGenerationJob(args: {
  storyboardId: string;
  jobId?: string;
}) {
  const { storyboardId } = args;

  requireEnv(['KIE_API_KEY'], 'KIE');

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: {
      scenes: true,
    },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  const results: SceneImageResult[] = [];

  for (const scene of storyboard.scenes) {
    const hasFrames = Boolean(scene.firstFrameUrl && scene.lastFrameUrl);
    if (hasFrames) {
      results.push({
        sceneId: scene.id,
        sceneNumber: scene.sceneNumber,
        firstFrameUrl: scene.firstFrameUrl as string,
        lastFrameUrl: scene.lastFrameUrl as string,
        videoPrompt: scene.videoPrompt,
      });
      continue;
    }

    try {
      const generated = await generateFramesForScene(scene as SceneLike);
      results.push(generated);
    } catch (err) {
      console.error(`Failed to generate frames for scene ${scene.id}:`, err);
      // continue to next scene
    }
  }

  const { scenesUpdated } = await persistSceneImages(storyboardId, results);
  const firstResult = results[0] ?? null;

  return {
    storyboardId,
    sceneCount: storyboard.scenes.length,
    scenesUpdated,
    firstFrameUrl: firstResult?.firstFrameUrl ?? null,
    lastFrameUrl: firstResult?.lastFrameUrl ?? null,
  };
}

export async function runVideoImageGeneration(args: {
  storyboardId: string;
  jobId?: string;
}) {
  return runVideoImageGenerationJob(args);
}

/**
 * Convenience wrapper: run video image generation as a Job.
 */
export async function startVideoImageGenerationJob(params: {
  storyboardId: string;
  jobId: string;
}) {
  const { storyboardId, jobId } = params;
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING },
  });
  try {
    const result = await runVideoImageGenerationJob({
      storyboardId,
      jobId,
    });

    const existing = await prisma.job.findUnique({
      where: { id: jobId },
      select: { payload: true },
    });
    const existingPayload = (existing?.payload ?? {}) as Record<string, any>;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        payload: {
          ...existingPayload,
          result: {
            ok: true,
            storyboardId: result.storyboardId,
            scenesUpdated: result.scenesUpdated,
            firstFrameUrl: result.firstFrameUrl,
            lastFrameUrl: result.lastFrameUrl,
          },
        },
        resultSummary: `Video frames saved: ${result.scenesUpdated}/${result.sceneCount} scenes`,
      },
    });

    return { jobId, ...result };
  } catch (err: any) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: err?.message ?? 'Unknown error during video image generation',
      },
    });

    throw err;
  }
}
