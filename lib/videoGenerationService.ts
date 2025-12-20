// lib/videoGenerationService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';

const KIE_BASE = env('KIE_API_BASE') ?? 'https://api.kie.ai/api/v1';
const KIE_VIDEO_MODEL = env('KIE_VIDEO_MODEL') ?? 'kling-1.6';
const DEFAULT_FPS = Number(env('KIE_VIDEO_FPS') ?? 24);
const DEFAULT_DURATION_SEC = Number(env('KIE_VIDEO_DURATION_SEC') ?? 6);

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
    state?: string;
    resultJson?: string;
    resultUrls?: string[] | string;
    result?: Record<string, any>;
    [key: string]: any;
  };
  [key: string]: any;
};

type SceneVideoResult = {
  sceneId: string;
  sceneNumber: number;
  videoUrl: string;
  providerTaskId: string;
  providerPayload: Record<string, any>;
};

type SceneLike = {
  id: string;
  sceneNumber: number;
  durationSec: number;
  aspectRatio: string;
  rawJson: unknown;
  videoPrompt: string | null;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  videoUrl: string | null;
};

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function collectResultUrls(data: KieJobResponse): string[] {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) urls.push(value.trim());
  };
  const pushUrls = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) pushUrl(item);
    } else if (typeof value === 'string') {
      pushUrl(value);
    }
  };

  pushUrls(data?.data?.resultUrls);
  pushUrls((data?.data as any)?.result?.resultUrls);
  pushUrl((data?.data as any)?.result?.video_url);
  pushUrl((data?.data as any)?.result?.videoUrl);
  pushUrl((data?.data as any)?.result?.url);

  const resultJson = data?.data?.resultJson;
  if (resultJson) {
    try {
      const parsed = JSON.parse(resultJson) as Record<string, any>;
      pushUrls(parsed?.resultUrls);
      pushUrl(parsed?.resultUrl);
      pushUrl(parsed?.video_url);
      pushUrl(parsed?.videoUrl);
      pushUrl(parsed?.url);
      pushUrls(parsed?.data?.resultUrls);
    } catch {
      // ignore JSON parse errors; fall back to other fields
    }
  }

  return urls;
}

async function createKieVideoJob(params: {
  prompt: string;
  imageInputs: string[];
  durationSec: number;
  aspectRatio: string;
  fps: number;
}): Promise<string> {
  const { prompt, imageInputs, durationSec, aspectRatio, fps } = params;

  const body = {
    model: KIE_VIDEO_MODEL,
    input: {
      prompt,
      image_input: imageInputs,
      duration: durationSec,
      fps,
      aspect_ratio: aspectRatio,
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

  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`KIE createTask invalid JSON: ${text}`);
  }

  const taskId =
    data?.taskId ??
    data?.id ??
    data?.data?.taskId ??
    data?.data?.id ??
    data?.result?.taskId;
  if (!taskId) {
    let compact = '';
    try {
      compact = JSON.stringify(data);
    } catch {
      compact = String(data);
    }
    throw new Error(`KIE createTask missing taskId: ${compact}`);
  }

  return String(taskId);
}

async function pollKieVideoJob(
  taskId: string,
  maxTries = 24,
  delayMs = 30000,
): Promise<string[]> {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const res = await fetch(
      `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: getKieHeaders(),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KIE recordInfo failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as KieJobResponse;
    const state = String(data?.data?.state ?? '').toLowerCase();

    if (state === 'success' || state === 'succeeded' || state === 'completed') {
      const urls = collectResultUrls(data);
      if (!urls.length) {
        throw new Error('KIE success result has no resultUrls');
      }
      return urls;
    }

    if (state && state !== 'ing' && state !== 'running') {
      throw new Error(`KIE job ended with state=${state}`);
    }

    await wait(delayMs);
  }

  throw new Error('KIE job did not complete in time');
}

async function generateVideoForScene(scene: SceneLike): Promise<SceneVideoResult> {
  const prompt = String(scene.videoPrompt ?? '').trim();
  if (!prompt) {
    throw new Error(`Scene ${scene.id} missing videoPrompt`);
  }

  const firstFrame = String(scene.firstFrameUrl ?? '').trim();
  const lastFrame = String(scene.lastFrameUrl ?? '').trim();
  if (!firstFrame || !lastFrame) {
    throw new Error(`Scene ${scene.id} missing firstFrameUrl or lastFrameUrl`);
  }

  const durationSec = Number(scene.durationSec ?? DEFAULT_DURATION_SEC) || DEFAULT_DURATION_SEC;
  const fps = Number(DEFAULT_FPS) || 24;
  const aspectRatio = String(scene.aspectRatio ?? '9:16');
  const imageInputs = [firstFrame, lastFrame];

  const taskId = await createKieVideoJob({
    prompt,
    imageInputs,
    durationSec,
    aspectRatio,
    fps,
  });
  const urls = await pollKieVideoJob(taskId);
  const videoUrl = urls[0];

  return {
    sceneId: scene.id,
    sceneNumber: scene.sceneNumber,
    videoUrl,
    providerTaskId: taskId,
    providerPayload: {
      provider: 'kie',
      taskId,
      model: KIE_VIDEO_MODEL,
      prompt,
      imageInputs,
      durationSec,
      fps,
      aspectRatio,
    },
  };
}

async function persistSceneVideos(storyboardId: string, results: SceneVideoResult[]) {
  if (results.length === 0) {
    return { scenesUpdated: 0, updatedSceneIds: [] as string[] };
  }

  const scenes = await prisma.storyboardScene.findMany({
    where: { storyboardId },
  });

  const byId = new Map<string, SceneVideoResult>();
  const byNumber = new Map<number, SceneVideoResult>();
  for (const result of results) {
    byId.set(result.sceneId, result);
    byNumber.set(result.sceneNumber, result);
  }

  let scenesUpdated = 0;
  const updatedSceneIds: string[] = [];

  for (const scene of scenes) {
    let match = byId.get(scene.id);
    if (!match && scene.sceneNumber !== null && scene.sceneNumber !== undefined) {
      match = byNumber.get(scene.sceneNumber);
    }
    if (!match) continue;

    const updateData: Record<string, any> = {};
    if (match.videoUrl && match.videoUrl !== scene.videoUrl) {
      updateData.videoUrl = match.videoUrl;
    }

    if (match.providerPayload) {
      const raw = scene.rawJson;
      const rawObject =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, any>)
          : {};
      updateData.rawJson = {
        ...rawObject,
        video_generation: match.providerPayload,
      };
    }

    if (Object.keys(updateData).length === 0) continue;

    await prisma.storyboardScene.update({
      where: { id: scene.id },
      data: updateData,
    });
    scenesUpdated += 1;
    updatedSceneIds.push(scene.id);
  }

  return { scenesUpdated, updatedSceneIds };
}

export async function runVideoGenerationJob(args: { storyboardId: string }) {
  const { storyboardId } = args;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    include: { scenes: true },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  const scenes = storyboard.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  const targetScenes = scenes.filter(scene => !scene.videoUrl);

  if (targetScenes.length === 0) {
    return {
      storyboardId,
      sceneCount: scenes.length,
      scenesUpdated: 0,
      updatedSceneIds: [] as string[],
      videoUrls: [] as string[],
      providerTaskIds: [] as string[],
    };
  }

  const results: SceneVideoResult[] = [];
  for (const scene of targetScenes) {
    const result = await generateVideoForScene(scene as SceneLike);
    results.push(result);
  }

  const { scenesUpdated, updatedSceneIds } = await persistSceneVideos(storyboardId, results);

  return {
    storyboardId,
    sceneCount: scenes.length,
    scenesUpdated,
    updatedSceneIds,
    videoUrls: results.map(result => result.videoUrl),
    providerTaskIds: results.map(result => result.providerTaskId),
  };
}
