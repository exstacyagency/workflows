// lib/videoReviewerService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';

const FAL_MERGE_URL = 'https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos';

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

async function pollFalResponse(url: string, max = 20, delayMs = 30000): Promise<any> {
  for (let i = 0; i < max; i++) {
    const res = await fetch(url, { headers: falHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fal queue poll failed: ${res.status} ${text}`);
    }
    const json = await res.json();

    // Fal queue format: adjust if necessary based on docs
    if (json.status === 'succeeded') {
      return json;
    }
    if (json.status === 'failed') {
      throw new Error('Fal merge job failed');
    }

    await wait(delayMs);
  }
  throw new Error('Fal merge job timed out');
}

/**
 * Merge all accepted scene videos for a storyboard into one final video,
 * then save the merged URL on the linked Script (and mark it upscale_pending).
 */
async function mergeStoryboardIfComplete(storyboardId: string) {
  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: {
      scenes: true,
      script: true,
    },
  });

  if (!storyboard) return null;

  const scenes = storyboard.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);

  if (scenes.length === 0) return null;

  const acceptedScenes = scenes.filter(s => s.status === 'accepted' && s.videoUrl);
  if (acceptedScenes.length !== scenes.length) {
    // Not all scenes accepted with videoUrl yet
    return null;
  }

  if (!storyboard.script) {
    // No script linked; nothing to update
    return null;
  }

  if (storyboard.script.mergedVideoUrl) {
    // Already merged before
    return storyboard.script.mergedVideoUrl;
  }

  const videoUrls = acceptedScenes.map(s => s.videoUrl as string);

  const mergeRes = await fetch(FAL_MERGE_URL, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({ video_urls: videoUrls }),
  });

  if (!mergeRes.ok) {
    const text = await mergeRes.text();
    throw new Error(`Fal merge request failed: ${mergeRes.status} ${text}`);
  }

  const mergeJson = await mergeRes.json();
  const responseUrl = mergeJson.response_url;
  if (!responseUrl) {
    throw new Error('Fal merge response missing response_url');
  }

  const final = await pollFalResponse(responseUrl);
  const mergedUrls = final?.resultUrls ?? final?.data?.response?.resultUrls ?? [];
  const mergedVideoUrl = mergedUrls[0];

  if (!mergedVideoUrl) {
    throw new Error('Fal merge finished but no resultUrls[0] found');
  }

  // Save onto Script
  await prisma.script.update({
    where: { id: storyboard.script.id },
    data: {
      mergedVideoUrl,
      status: 'upscale_pending',
    },
  });

  return mergedVideoUrl;
}

/**
 * Main entrypoint: scan all storyboards, merge those where all scenes are accepted.
 */
export async function runVideoReviewer() {
  requireEnv(['FAL_API_KEY'], 'FAL');

  const storyboards = await prisma.storyboard.findMany({
    include: {
      scenes: true,
      script: true,
    },
  });

  const merged: { storyboardId: string; mergedVideoUrl: string }[] = [];

  for (const sb of storyboards) {
    try {
      const mergedUrl = await mergeStoryboardIfComplete(sb.id);
      if (mergedUrl) {
        merged.push({
          storyboardId: sb.id,
          mergedVideoUrl: mergedUrl,
        });
      }
    } catch (err) {
      console.error(`Error merging storyboard ${sb.id}:`, err);
    }
  }

  return { merged };
}
