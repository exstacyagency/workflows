// lib/videoUpscalerService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';

const FAL_UPSCALE_URL = 'https://queue.fal.run/fal-ai/video-upscaler';

function falHeaders() {
  requireEnv(['FAL_API_KEY'], 'FAL');
  const apiKey = env('FAL_API_KEY')!;
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll Fal queue for upscaler completion.
 * The n8n flow expects response with `video.url`.
 */
async function pollUpscaleRequest(
  requestId: string,
  maxAttempts = 20,
  delayMs = 30000,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `https://queue.fal.run/fal-ai/video-upscaler/requests/${encodeURIComponent(
        requestId,
      )}`,
      {
        method: 'GET',
        headers: falHeaders(),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upscaler status failed: ${res.status} ${text}`);
    }

    const json = await res.json();

    // Common Fal pattern: status + video.url
    const status = json.status;
    const videoUrl = json.video?.url as string | undefined;

    if (status === 'succeeded' && videoUrl) {
      return videoUrl;
    }

    if (status === 'failed') {
      const errMsg = json.error || 'Upscaler job failed';
      throw new Error(errMsg);
    }

    // still processing
    await wait(delayMs);
  }

  throw new Error('Upscaler timed out after multiple attempts');
}

/**
 * Upscale a single script's merged video.
 */
async function upscaleSingleScript(scriptId: string) {
  const script = await prisma.script.findUnique({
    where: { id: scriptId },
  });

  if (!script) return;
  if (!script.mergedVideoUrl) {
    throw new Error('Script has no mergedVideoUrl to upscale');
  }

  // Already upscaled? Skip.
  if (script.upscaledVideoUrl) {
    return;
  }

  // 1) Send request to Fal video upscaler
  const upReq = await fetch(FAL_UPSCALE_URL, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({
      video_url: script.mergedVideoUrl,
      scale: 2, // same as workflow
    }),
  });

  if (!upReq.ok) {
    const text = await upReq.text();
    throw new Error(`Upscale request failed: ${upReq.status} ${text}`);
  }

  const upReqJson = await upReq.json();

  const requestId = upReqJson.request_id as string | undefined;
  if (!requestId) {
    throw new Error('Upscale request missing request_id');
  }

  // 2) Poll until success or error
  const upscaledUrl = await pollUpscaleRequest(requestId);

  // 3) Save success on Script
  await prisma.script.update({
    where: { id: script.id },
    data: {
      upscaledVideoUrl: upscaledUrl,
      status: 'upscaled',
      upscaleError: null,
    },
  });
}

/**
 * Batch worker: find all scripts that are `upscale_pending`
 * and have a mergedVideoUrl but no upscaledVideoUrl yet.
 */
export async function runVideoUpscalerBatch() {
  requireEnv(['FAL_API_KEY'], 'FAL');

  const scripts = await prisma.script.findMany({
    where: {
      status: 'upscale_pending',
      mergedVideoUrl: { not: null },
      upscaledVideoUrl: null,
    },
  });

  const results: {
    scriptId: string;
    success: boolean;
    message?: string;
  }[] = [];

  for (const script of scripts) {
    try {
      await upscaleSingleScript(script.id);
      results.push({
        scriptId: script.id,
        success: true,
        message: 'Upscaled successfully',
      });
    } catch (err: any) {
      console.error(`Upscale failed for script ${script.id}:`, err);
      // record error onto script
      await prisma.script.update({
        where: { id: script.id },
        data: {
          status: 'upscale_failed',
          upscaleError: err?.message ?? 'Unknown upscaler error',
        },
      });
      results.push({
        scriptId: script.id,
        success: false,
        message: err?.message ?? 'Unknown error',
      });
    }
  }

  return {
    count: scripts.length,
    results,
  };
}
