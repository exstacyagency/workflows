// lib/videoGenerationService.ts
import prisma from '@/lib/prisma';
import { env, requireEnv } from './configGuard.ts';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  assertProductSetupReferenceReachable,
  assertProductSetupReferenceUrl,
} from "@/lib/productSetupReferencePolicy";

function normalizeKieVideoModel(value: string | null | undefined, fallback: 'veo3' | 'veo3_fast'): 'veo3' | 'veo3_fast' {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === 'veo3' || normalized === 'veo3_fast') {
    return normalized;
  }
  return fallback;
}

const KIE_IMAGE_TO_VIDEO_MODEL = normalizeKieVideoModel(
  env('KIE_IMAGE_TO_VIDEO_MODEL'),
  'veo3_fast',
);
const KIE_TEXT_TO_VIDEO_MODEL = normalizeKieVideoModel(
  env('KIE_TEXT_TO_VIDEO_MODEL'),
  'veo3_fast',
);
const KIE_IMAGE_TO_VIDEO_MODEL_FALLBACK = 'veo3';
const KIE_TEXT_TO_VIDEO_MODEL_FALLBACK = 'veo3';
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
  panelType?: 'ON_CAMERA' | 'PRODUCT_ONLY' | 'B_ROLL_ONLY' | null;
  videoPrompt: string | null;
  firstFrameImageUrl?: string | null;
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
  const panelType = String(args.raw.panelType ?? "ON_CAMERA");
  const includeCharacter = panelType === "ON_CAMERA" || panelType === "PRODUCT_ONLY";

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
  if (includeCharacter && characterAvatarImageUrl) {
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
  const normalizedImageInputs = Array.from(
    new Set(
      imageInputs
        .map((url) => normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .slice(0, 2),
    ),
  );
  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? "us-east-2",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const presignedImageUrls = await Promise.all(
    normalizedImageInputs.map(async (url) => {
      try {
        const parsed = new URL(url);
        const bucket = parsed.hostname.split(".")[0];
        const key = parsed.pathname.slice(1);
        return await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: 3600 }
        );
      } catch {
        return url;
      }
    })
  );

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
    console.log('[KIE POST]', JSON.stringify(body, null, 2));
    const res = await fetch(`https://api.kie.ai/api/v1/veo/generate`, {
      method: 'POST',
      headers: getKieHeaders(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('[KIE RESPONSE]', res.status, text);

    if (!res.ok) {
      throw new Error(`KIE createTask failed: ${res.status} ${text}`);
    }

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
    prompt,
    imageUrls: presignedImageUrls,
    aspect_ratio: '9:16',
    generationType: 'FIRST_AND_LAST_FRAMES_2_VIDEO',
  };

  const textToVideoBody: Record<string, any> = {
    model: KIE_TEXT_TO_VIDEO_MODEL,
    prompt,
    aspect_ratio: '9:16',
    generationType: 'TEXT_2_VIDEO',
  };

  console.log(
    '[KIE DEBUG] payload:',
    JSON.stringify(presignedImageUrls.length > 0 ? imageToVideoBody : textToVideoBody, null, 2),
  );

  // If no images are available, use text-to-video.
  if (presignedImageUrls.length === 0) {
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
  maxWaitMs = 20 * 60_000,
  intervalMs = 15_000,
): Promise<string[]> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.kie.ai/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: getKieHeaders() },
    );

    if (!res.ok) {
      throw new Error(`KIE recordInfo failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const successFlag = data?.data?.successFlag;

    // 1 = success
    if (successFlag === 1) {
      const urls: string[] = (data?.data?.response?.resultUrls ?? [])
        .map((u: unknown) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean);
      if (urls.length === 0) throw new Error(`KIE successFlag=1 but no resultUrls`);
      return urls;
    }

    // 2 = failed, 3 = generation failed
    if (successFlag === 2 || successFlag === 3) {
      const errMsg = data?.data?.errorMessage || data?.msg || `successFlag=${successFlag}`;
      throw new Error(`KIE video failed: ${errMsg}`);
    }

    // 0 = still generating — keep polling
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`KIE video poll timed out after ${maxWaitMs}ms`);
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

  // First-frame image is the primary visual anchor for this scene.
  const firstFrameImageUrl = normalizeUrl(
    asString((scene as any).firstFrameS3Url) ||
    asString(raw.firstFrameS3Url) ||
    asString((scene as any).firstFrameImageUrl) ||
    asString(raw.firstFrameImageUrl) ||
    asString(raw.firstFrameUrl) ||
    null,
  );
  if (!firstFrameImageUrl) {
    throw new Error(`Scene ${(scene as any).sceneNumber ?? (scene as any).id} missing firstFrameImageUrl`);
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
  const imageInputs = [firstFrameImageUrl];

  const taskId = await createKieVideoJob({
    prompt,
    imageInputs,
    referenceFrames,
    nFrames,
    aspectRatio,
    uploadMethod,
  });
  const urls = await pollKieVideoJob(taskId, 18 * 60_000);
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
  const rawSceneNumber = payload.sceneNumber;
  const parsedSceneNumber = rawSceneNumber !== undefined && rawSceneNumber !== null
    ? Number(rawSceneNumber)
    : null;
  const requestedSceneNumber =
    parsedSceneNumber !== null && Number.isInteger(parsedSceneNumber) && parsedSceneNumber > 0
      ? parsedSceneNumber
      : null;

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
  const filteredScenes =
    requestedSceneNumber !== null
      ? scenes.filter((scene) => scene.sceneNumber === requestedSceneNumber)
      : scenes;
  if (requestedSceneNumber !== null && filteredScenes.length === 0) {
    throw new Error(`Scene ${requestedSceneNumber} not found`);
  }
  const existingUrls = scenes
    .map(scene => (scene as any).videoUrl ?? (scene.rawJson as any)?.videoUrl ?? (scene.rawJson as any)?.video_url)
    .filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
  const targetScenes =
    requestedSceneNumber !== null
      ? filteredScenes
      : filteredScenes.filter(scene => !((scene as any).videoUrl ?? (scene.rawJson as any)?.videoUrl ?? (scene.rawJson as any)?.video_url));
  const scenesMissingFirstFrame = targetScenes
    .map((scene) => ({
      sceneNumber: Number((scene as any).sceneNumber ?? 0),
      firstFrameImageUrl: normalizeUrl(
        asString((scene as any).firstFrameS3Url) ||
          asString((scene as any).rawJson?.firstFrameS3Url) ||
        asString((scene as any).firstFrameImageUrl) ||
          asString((scene as any).rawJson?.firstFrameImageUrl) ||
          asString((scene as any).rawJson?.firstFrameUrl) ||
          null,
      ),
    }))
    .filter((scene) => !scene.firstFrameImageUrl)
    .map((scene) => scene.sceneNumber)
    .filter((sceneNumber) => Number.isInteger(sceneNumber) && sceneNumber > 0);
  if (scenesMissingFirstFrame.length > 0) {
    throw new Error(
      `Missing first-frame image for scene(s): ${scenesMissingFirstFrame.join(", ")}. Generate first frames before video generation.`,
    );
  }

  if (targetScenes.length === 0 && requestedSceneNumber === null) {
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
