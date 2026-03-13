// lib/videoUpscalerService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';
import { computeFalUpscaleCostCents, type FalUpscaleTier } from "@/lib/billing/pricing";

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
): Promise<{ videoUrl: string; width?: number; height?: number; duration?: number; computeSeconds?: number }> {
  // TODO(medium): persist provider request IDs on the script before polling so failed runs can be resumed or inspected.
  const pollStart = Date.now();

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
      const computeSeconds = (Date.now() - pollStart) / 1000;
      return {
        videoUrl,
        width: json.video?.width ?? json.metadata?.width ?? undefined,
        height: json.video?.height ?? json.metadata?.height ?? undefined,
        duration: json.video?.duration ?? json.metadata?.duration ?? undefined,
        computeSeconds,
      };
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
async function upscaleSingleScript(scriptId: string): Promise<{
  costCents: number;
  tier: string;
  outputSeconds: number;
  computeSeconds: number;
  width?: number;
  height?: number;
} | null> {
  const script = await prisma.script.findUnique({ where: { id: scriptId } });
  if (!script) return null;
  if (!script?.mergedVideoUrl) throw new Error("Script has no mergedVideoUrl to upscale");

  // Already upscaled? Skip.
  if (script.upscaledVideoUrl) {
    return null;
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
  if (!requestId) throw new Error("Upscale request missing request_id");

  // 2) Poll until success or error
  const result = await pollUpscaleRequest(requestId);

  // 3) Save success on Script
  await prisma.script.update({
    where: { id: script.id },
    data: {
      upscaledVideoUrl: result.videoUrl,
      status: 'upscaled',
      upscaleError: null,
    },
  });

  // Determine billing tier from output resolution
  // Input is 720x1280, scale=2 -> output is 1440x2560 -> above1080p tier
  // If Fal returns real dimensions use those, otherwise fall back to above1080p
  const outputWidth = result.width ?? 1440;
  const outputHeight = result.height ?? 2560;
  const outputSeconds = result.duration ?? 8;
  const computeSeconds = result.computeSeconds ?? 0;

  let tier: FalUpscaleTier;
  const maxDim = Math.max(outputWidth, outputHeight);
  if (maxDim <= 720) tier = "up720p";
  else if (maxDim <= 1080) tier = "720p_to_1080p";
  else tier = "above1080p";

  // Fal upscale bills per output second, not compute second
  const is60fps = false;
  const costCents = computeFalUpscaleCostCents(outputSeconds, tier, is60fps);

  console.log("[fal/upscale] cost tracking", {
    scriptId,
    requestId,
    outputWidth,
    outputHeight,
    outputSeconds,
    computeSeconds,
    tier,
    costCents,
  });

  return { costCents, tier, outputSeconds, computeSeconds, width: outputWidth, height: outputHeight };
}

/**
 * Batch worker: find all scripts that are `upscale_pending`
 * and have a mergedVideoUrl but no upscaledVideoUrl yet.
 */
export async function runVideoUpscalerBatch(): Promise<{
  count: number;
  results: {
    scriptId: string;
    success: boolean;
    message?: string;
    costCents?: number;
    tier?: string;
    outputSeconds?: number;
  }[];
}> {
  requireEnv(["FAL_API_KEY"], "FAL");

  // TODO(medium): batch this query instead of scanning every pending upscale in one pass when the script table grows.
  const scripts = await prisma.script.findMany({
    where: {
      status: "upscale_pending",
      mergedVideoUrl: { not: null },
      upscaledVideoUrl: null,
    },
  });

  const results: {
    scriptId: string;
    success: boolean;
    message?: string;
    costCents?: number;
    tier?: string;
    outputSeconds?: number;
  }[] = [];

  for (const script of scripts) {
    try {
      const costMeta = await upscaleSingleScript(script.id);
      results.push({
        scriptId: script.id,
        success: true,
        message: "Upscaled successfully",
        costCents: costMeta?.costCents,
        tier: costMeta?.tier,
        outputSeconds: costMeta?.outputSeconds,
      });
    } catch (err: any) {
      console.error(`Upscale failed for script ${script.id}:`, err);
      // record error onto script
      await prisma.script.update({
        where: { id: script.id },
        data: {
          status: "upscale_failed",
          upscaleError: err?.message ?? "Unknown upscaler error",
        },
      });
      results.push({
        scriptId: script.id,
        success: false,
        message: err?.message ?? "Unknown error",
      });
    }
  }

  return { count: scripts.length, results };
}
