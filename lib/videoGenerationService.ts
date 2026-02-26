// lib/videoGenerationService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';
import {
  assertProductSetupReferenceReachable,
  assertProductSetupReferenceUrl,
} from "@/lib/productSetupReferencePolicy";

const KIE_BASE = env('KIE_API_BASE') ?? 'https://api.kie.ai/api/v1';
const KIE_IMAGE_TO_VIDEO_MODEL =
  env('KIE_IMAGE_TO_VIDEO_MODEL') ?? 'sora-2-image-to-video-stable';
const KIE_TEXT_TO_VIDEO_MODEL =
  env('KIE_TEXT_TO_VIDEO_MODEL') ?? 'sora-2-text-to-video-stable';
const KIE_IMAGE_TO_VIDEO_MODEL_FALLBACK = 'sora-2-image-to-video';
const KIE_TEXT_TO_VIDEO_MODEL_FALLBACK = 'sora-2-text-to-video';
const DEFAULT_DURATION_SEC = Number(env('KIE_VIDEO_DURATION_SEC') ?? 6);

function getKieHeaders() {
  requireEnv(['KIE_API_KEY'], 'KIE');
  const apiKey = env('KIE_API_KEY')!;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
  const spendConfirmHeader = env('KIE_SPEND_CONFIRM_HEADER');
  const spendConfirmValue = env('KIE_SPEND_CONFIRM_VALUE');
  if (spendConfirmHeader && spendConfirmValue) {
    headers[spendConfirmHeader] = spendConfirmValue;
  } else {
    // Default header used by other KIE flows in this app.
    headers['x-kie-spend-confirm'] = '1';
  }
  return headers;
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
  clipDurationSeconds?: number | null;
  aspectRatio: string;
  rawJson: unknown;
  panelType?: 'ON_CAMERA' | 'B_ROLL_ONLY' | null;
  videoPrompt: string | null;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  videoUrl: string | null;
};

type ProductReferenceImages = {
  productReferenceImageUrl: string | null;
  characterAvatarImageUrl: string | null;
};

type SceneReferenceFrame = {
  kind: 'product' | 'character';
  role: 'product' | 'character';
  url: string;
};

type JobLike = {
  id: string;
  projectId: string;
  payload: unknown;
};

type RunResult = {
  ok: true;
  storyboardId: string;
  scriptId: string;
  sceneCount: number;
  scenesUpdated: number;
  updatedSceneIds: string[];
  videoUrls: string[];
  taskIds: string[];
  mergedVideoUrl?: string | null;
  skipped?: boolean;
  reason?: string;
};

function asObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSoraClipDuration(raw: number | null | undefined): 10 | 15 {
  if (raw === 15) return 15;
  return 10;
}

function normalizeReferenceFrames(value: unknown): SceneReferenceFrame[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const raw = asObject(entry);
      const kind = raw.kind === 'product' ? 'product' : raw.kind === 'character' ? 'character' : null;
      const role = raw.role === 'product' ? 'product' : raw.role === 'character' ? 'character' : null;
      const url = normalizeUrl(raw.url);
      if (!kind || !role || !url) return null;
      return { kind, role, url };
    })
    .filter((entry): entry is SceneReferenceFrame => Boolean(entry));
}

function buildSceneReferenceFrames(args: {
  raw: Record<string, any>;
  productReferenceImages: ProductReferenceImages;
}): SceneReferenceFrame[] {
  const rawFrames = normalizeReferenceFrames(args.raw.referenceFrames);
  const productFromRaw = rawFrames.find((frame) => frame.kind === 'product')?.url;
  const characterFromRaw = rawFrames.find((frame) => frame.kind === 'character')?.url;

  const productReferenceImageUrl = normalizeUrl(
    productFromRaw ?? args.raw.productReferenceImageUrl ?? args.productReferenceImages.productReferenceImageUrl,
  );
  const characterAvatarImageUrl = normalizeUrl(
    characterFromRaw ?? args.raw.characterAvatarImageUrl ?? args.productReferenceImages.characterAvatarImageUrl,
  );

  const frames: SceneReferenceFrame[] = [];
  if (characterAvatarImageUrl) {
    frames.push({
      kind: 'character',
      role: 'character',
      url: characterAvatarImageUrl,
    });
  }
  if (productReferenceImageUrl) {
    frames.push({
      kind: 'product',
      role: 'product',
      url: productReferenceImageUrl,
    });
  }
  return frames;
}

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

function extractKieErrorDetail(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
  const rootCode = payload.code;
  const dataCode = data?.code;
  const code = rootCode ?? dataCode;

  const msgCandidates = [
    payload.msg,
    payload.message,
    payload.error,
    data?.msg,
    data?.message,
    data?.error,
    data?.reason,
    data?.failReason,
    data?.fail_reason,
  ];
  const msg = msgCandidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!msg && code == null) return null;
  const codeText = code != null ? `code=${String(code)}` : null;
  return [codeText, typeof msg === 'string' ? msg.trim() : null].filter(Boolean).join(' ');
}

async function createKieVideoJob(params: {
  prompt: string;
  imageInputs: string[];
  referenceFrames?: SceneReferenceFrame[];
  nFrames: 10 | 15;
  aspectRatio: 'portrait' | 'landscape';
  uploadMethod: 's3' | 'oss';
}): Promise<string> {
  const {
    prompt,
    imageInputs,
    referenceFrames = [],
    nFrames,
    aspectRatio,
    uploadMethod,
  } = params;

  const parseTaskId = (data: any): string => {
    const taskId =
      data?.taskId ??
      data?.id ??
      data?.data?.taskId ??
      data?.data?.id ??
      data?.result?.taskId;
    if (!taskId) {
      const detail = extractKieErrorDetail(data);
      if (detail) {
        throw new Error(`KIE createTask rejected: ${detail}`);
      }
      let compact = '';
      try {
        compact = JSON.stringify(data);
      } catch {
        compact = String(data);
      }
      throw new Error(`KIE createTask missing taskId: ${compact}`);
    }

    return String(taskId);
  };

  const withModel = (body: Record<string, any>, model: string): Record<string, any> => ({
    ...body,
    model,
  });

  const postCreateTask = async (body: Record<string, any>): Promise<string> => {
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

    return parseTaskId(data);
  };

  const imageToVideoBody: Record<string, any> = {
    model: KIE_IMAGE_TO_VIDEO_MODEL,
    input: {
      prompt,
      image_urls: imageInputs,
      aspect_ratio: aspectRatio,
      n_frames: String(nFrames),
      upload_method: uploadMethod,
    },
  };

  const textToVideoBody: Record<string, any> = {
    model: KIE_TEXT_TO_VIDEO_MODEL,
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      n_frames: String(nFrames),
      upload_method: uploadMethod,
    },
  };

  // Image-to-video requires input.image_urls. If none exist, always use text-to-video.
  if (imageInputs.length === 0) {
    try {
      return await postCreateTask(textToVideoBody);
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const shouldRetryAltModel =
        message.includes('KIE createTask missing taskId') &&
        message.includes('This field is required');
      if (!shouldRetryAltModel) throw error;
      return postCreateTask(withModel(textToVideoBody, KIE_TEXT_TO_VIDEO_MODEL_FALLBACK));
    }
  }

  try {
    return await postCreateTask(imageToVideoBody);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const isRequestShapeError =
      message.includes('KIE createTask failed: 400') ||
      message.includes('KIE createTask failed: 422');
    const shouldRetryAltImageModel =
      message.includes('KIE createTask missing taskId') &&
      message.includes('This field is required');
    if (shouldRetryAltImageModel) {
      try {
        return await postCreateTask(
          withModel(imageToVideoBody, KIE_IMAGE_TO_VIDEO_MODEL_FALLBACK),
        );
      } catch {
        // Fall through to text fallback below.
      }
    } else if (!isRequestShapeError) {
      throw error;
    }
    try {
      return await postCreateTask(textToVideoBody);
    } catch (textError: any) {
      const textMsg = String(textError?.message ?? textError);
      const shouldRetryAltTextModel =
        textMsg.includes('KIE createTask missing taskId') &&
        textMsg.includes('This field is required');
      if (!shouldRetryAltTextModel) throw textError;
      return postCreateTask(withModel(textToVideoBody, KIE_TEXT_TO_VIDEO_MODEL_FALLBACK));
    }
  }
}

async function pollKieVideoJob(
  taskId: string,
  maxTries = 24,
  delayMs = 30000,
): Promise<string[]> {
  const inProgressStates = new Set([
    'ing',
    'running',
    'waiting',
    'queued',
    'pending',
    'processing',
  ]);

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

    if (state && !inProgressStates.has(state)) {
      const detail = extractKieErrorDetail(data as any);
      throw new Error(
        detail
          ? `KIE job ended with state=${state}: ${detail}`
          : `KIE job ended with state=${state}`,
      );
    }

    await wait(delayMs);
  }

  throw new Error('KIE job did not complete in time');
}

async function generateVideoForScene(
  scene: SceneLike,
  productReferenceImages: ProductReferenceImages,
): Promise<SceneVideoResult> {
  const raw = asObject((scene as any).rawJson);
  const prompt = String((scene as any).videoPrompt ?? raw.videoPrompt ?? '').trim();
  if (!prompt) {
    throw new Error(`Scene ${(scene as any).id} missing videoPrompt`);
  }

  const clipDurationFromScene = Number((scene as any).clipDurationSeconds);
  const fallbackDuration = Number((scene as any).durationSec ?? raw.durationSec ?? raw.duration ?? DEFAULT_DURATION_SEC) || DEFAULT_DURATION_SEC;
  const durationSec = normalizeSoraClipDuration(
    Number.isFinite(clipDurationFromScene) ? clipDurationFromScene : fallbackDuration
  );
  const nFrames: 10 | 15 = durationSec === 15 ? 15 : 10;
  const aspectRatio: 'portrait' | 'landscape' = 'portrait';
  const uploadMethod: 's3' | 'oss' = 's3';
  const referenceFrames = buildSceneReferenceFrames({
    raw,
    productReferenceImages,
  });
  const imageInputs = Array.from(new Set(referenceFrames.map((frame) => frame.url).filter(Boolean)));

  const taskId = await createKieVideoJob({
    prompt,
    imageInputs,
    referenceFrames,
    nFrames,
    aspectRatio,
    uploadMethod,
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
      model: imageInputs.length > 0 ? KIE_IMAGE_TO_VIDEO_MODEL : KIE_TEXT_TO_VIDEO_MODEL,
      prompt,
      imageInputs,
      referenceFrames,
      nFrames,
      aspectRatio,
      uploadMethod,
    },
  };
}

async function loadProductReferenceImages(args: {
  projectId: string;
  productId: string | null;
}): Promise<ProductReferenceImages> {
  if (!args.productId) {
    return {
      productReferenceImageUrl: null,
      characterAvatarImageUrl: null,
    };
  }

  const productRows = await prisma.$queryRaw<Array<{
    productReferenceImageUrl: string | null;
    characterAvatarImageUrl: string | null;
  }>>`
    SELECT
      "product_reference_image_url" AS "productReferenceImageUrl",
      "character_avatar_image_url" AS "characterAvatarImageUrl"
    FROM "product"
    WHERE "id" = ${args.productId}
      AND "project_id" = ${args.projectId}
    LIMIT 1
  `;

  const productReferenceImageUrl = normalizeUrl(productRows[0]?.productReferenceImageUrl);
  const characterAvatarImageUrl = normalizeUrl(productRows[0]?.characterAvatarImageUrl);

  if (productReferenceImageUrl) {
    assertProductSetupReferenceUrl(productReferenceImageUrl, "productReferenceImageUrl");
    await assertProductSetupReferenceReachable(
      productReferenceImageUrl,
      "productReferenceImageUrl",
    );
  }

  return {
    productReferenceImageUrl,
    characterAvatarImageUrl,
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
    const raw = (scene as any).rawJson;
    const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
    // Always merge videoUrl into rawJson rather than set a non-existent top-level column
    if (match.videoUrl && match.videoUrl !== (scene as any).videoUrl && match.videoUrl !== rawObject.videoUrl && match.videoUrl !== rawObject.video_url) {
      rawObject.videoUrl = match.videoUrl;
      rawObject.video_url = match.videoUrl;
    }

    if (match.providerPayload) {
      rawObject.video_generation = match.providerPayload;
    }

    if (Object.keys(rawObject).length) {
      updateData.rawJson = rawObject;
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

export async function runVideoGenerationJob(job: JobLike): Promise<RunResult> {
  const payload = asObject(job.payload);
  const projectId = String(payload.projectId ?? '').trim();
  const storyboardId = String(payload.storyboardId ?? '').trim();
  const scriptId = String(payload.scriptId ?? '').trim();
  const payloadProductId = asString(payload.productId) || null;

  const missing: string[] = [];
  if (!projectId) missing.push('projectId');
  if (!storyboardId) missing.push('storyboardId');
  if (!scriptId) missing.push('scriptId');
  if (missing.length > 0) {
    throw new Error(`Invalid payload: missing ${missing.join(', ')}`);
  }

  if (projectId && job.projectId && projectId !== job.projectId) {
    throw new Error('Invalid payload: projectId mismatch');
  }

  const storyboard = await prisma.storyboard.findFirst({
    where: { id: storyboardId, projectId },
    include: { scenes: true },
  });

  if (!storyboard) {
    throw new Error('Storyboard not found');
  }

  if (!storyboard.scenes.length) {
    throw new Error('Storyboard has no scenes');
  }

  const script = await prisma.script.findFirst({
    where: { id: scriptId, projectId },
    select: {
      id: true,
      mergedVideoUrl: true,
      job: {
        select: {
          payload: true,
        },
      },
    },
  });
  if (!script) {
    throw new Error('Script not found');
  }
  const scriptJobPayload = asObject(script.job?.payload);
  const effectiveProductId = payloadProductId || asString(scriptJobPayload?.productId) || null;
  const productReferenceImages = await loadProductReferenceImages({
    projectId,
    productId: effectiveProductId,
  });

  const scenes = storyboard.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);
  const existingUrls = scenes
    .map(scene => (scene as any).videoUrl ?? (scene.rawJson as any)?.videoUrl ?? (scene.rawJson as any)?.video_url)
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
  const targetScenes = scenes.filter(scene => !((scene as any).videoUrl ?? (scene.rawJson as any)?.videoUrl ?? (scene.rawJson as any)?.video_url));

  if (targetScenes.length === 0) {
    let mergedVideoUrl = script.mergedVideoUrl ?? null;
    if (!mergedVideoUrl && scenes.length === 1 && existingUrls[0]) {
      mergedVideoUrl = existingUrls[0];
      await prisma.script.update({
        where: { id: script.id },
        data: { mergedVideoUrl },
      });
    }
    return {
      ok: true,
      storyboardId,
      scriptId,
      sceneCount: scenes.length,
      scenesUpdated: 0,
      updatedSceneIds: [],
      videoUrls: existingUrls,
      taskIds: [],
      mergedVideoUrl,
      skipped: true,
      reason: 'already_generated',
    };
  }

  const results: SceneVideoResult[] = [];
  let scenesUpdated = 0;
  const updatedSceneIds: string[] = [];
  for (const scene of targetScenes) {
    try {
      const result = await generateVideoForScene(
        scene as unknown as SceneLike,
        productReferenceImages,
      );
      results.push(result);

      // Persist each scene as soon as it succeeds so retries can resume from failures.
      const persisted = await persistSceneVideos(storyboardId, [result]);
      scenesUpdated += persisted.scenesUpdated;
      updatedSceneIds.push(...persisted.updatedSceneIds);
    } catch (error: any) {
      const sceneNumber = Number((scene as any).sceneNumber ?? 0) || 0;
      const originalMessage = String(error?.message ?? error ?? "Unknown error");
      throw new Error(
        `Scene ${sceneNumber || "unknown"} failed after ${results.length} successful scene(s): ${originalMessage}`,
      );
    }
  }

  let mergedVideoUrl = script.mergedVideoUrl ?? null;
  if (!mergedVideoUrl && scenes.length === 1) {
    const singleUrl = results[0]?.videoUrl ?? existingUrls[0] ?? null;
    if (singleUrl) {
      mergedVideoUrl = singleUrl;
      await prisma.script.update({
        where: { id: script.id },
        data: { mergedVideoUrl },
      });
    }
  }

  return {
    ok: true,
    storyboardId,
    scriptId,
    sceneCount: scenes.length,
    scenesUpdated,
    updatedSceneIds,
    videoUrls: [...existingUrls, ...results.map(result => result.videoUrl)],
    taskIds: results.map(result => result.providerTaskId),
    mergedVideoUrl,
  };
}
