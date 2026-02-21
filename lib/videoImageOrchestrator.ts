import { cfg } from "@/lib/config";
import { getProvider } from "@/lib/imageProviders/registry";
import type { ImageProviderId } from "@/lib/imageProviders/types";

export type FramePrompt = {
  frameIndex: number;
  sceneId?: string | null;
  sceneNumber?: number;
  frameType?: "first" | "last";
  // Backward compatibility with older payload shape.
  promptKind?: "first" | "last";
  prompt: string;
  negativePrompt?: string;
  inputImageUrl?: string | null;
  previousSceneLastFrameImageUrl?: string | null;
  maskImageUrl?: string | null;
  width?: number;
  height?: number;
};

export type StartMultiFrameArgs = {
  storyboardId: string;
  providerId?: ImageProviderId;
  force?: boolean;
  // Optional nonce to intentionally bypass idempotency and create a fresh paid run.
  // Recommended: client passes Date.now().toString() when user clicks "Force rerun".
  runNonce?: string;
  prompts: FramePrompt[];
};

export type FrameTask = {
  frameIndex: number;
  sceneId: string | null;
  sceneNumber: number;
  frameType: "first" | "last";
  // Backward compatibility for existing job payloads and UI consumers.
  promptKind?: "first" | "last";
  taskId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  url?: string | null;
  error?: string | null;
};

export type StartMultiFrameResult = {
  providerId: ImageProviderId;
  idempotencyKey: string;
  taskGroupId: string; // stable group id (hash of idempotencyKey)
  tasks: FrameTask[];
};

function mustEnv(name: string, fallback?: string): string {
  const v = cfg.raw(name) ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function buildGroupIdempotencyKey(args: {
  storyboardId: string;
  providerId: string;
  force?: boolean;
  runNonce?: string;
}): string {
  return JSON.stringify([
    "proj_test",
    "VIDEO_IMAGE_GENERATION",
    args.storyboardId,
    args.providerId,
    args.force ? "force" : "noforce",
    args.runNonce ? `nonce:${args.runNonce}` : "nonce:none",
  ]);
}

function buildFrameIdempotencyKey(args: {
  groupKey: string;
  frameIndex: number;
  sceneId?: string | null;
  sceneNumber: number;
  frameType: "first" | "last";
}): string {
  const sceneIdentity = String(args.sceneId ?? "").trim() || String(args.sceneNumber);
  return JSON.stringify([
    args.groupKey,
    "scene",
    sceneIdentity,
    args.frameType,
    "frame",
    args.frameIndex,
  ]);
}

function stableGroupId(groupKey: string): string {
  // cheap deterministic id without adding deps
  let h = 2166136261;
  for (let i = 0; i < groupKey.length; i++) {
    h ^= groupKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `vig_${(h >>> 0).toString(16)}`;
}

export async function startMultiFrameVideoImages(args: StartMultiFrameArgs): Promise<StartMultiFrameResult> {
  const provider = getProvider(args.providerId);
  const providerId = provider.id;

  // Default deny spend unless explicitly enabled.
  if ((cfg.raw("KIE_LIVE_MODE") ?? "0") !== "1") {
    throw new Error("KIE live mode is disabled. Set KIE_LIVE_MODE=1 to allow paid image generation.");
  }

  if (!args.prompts?.length) throw new Error("prompts[] is required");
  for (const p of args.prompts) {
    if (!p?.prompt?.trim()) throw new Error(`prompts[${p.frameIndex}].prompt is required`);
  }

  const groupKey = buildGroupIdempotencyKey({
    storyboardId: args.storyboardId,
    providerId,
    force: !!args.force,
    runNonce: args.runNonce ? String(args.runNonce) : undefined,
  });

  const taskGroupId = stableGroupId(groupKey);

  // Nano Banana Pro is single-image per task.
  // Generate every provided prompt (e.g. 2 prompts x 6 scenes = 12 tasks).
  const selected = [...args.prompts].sort((a, b) => {
    const aScene = Number.isFinite(Number(a.sceneNumber)) ? Number(a.sceneNumber) : Number(a.frameIndex);
    const bScene = Number.isFinite(Number(b.sceneNumber)) ? Number(b.sceneNumber) : Number(b.frameIndex);
    if (aScene !== bScene) return aScene - bScene;
    const aFrameType = a.frameType === "last" || a.promptKind === "last" ? "last" : "first";
    const bFrameType = b.frameType === "last" || b.promptKind === "last" ? "last" : "first";
    const aKindRank = aFrameType === "last" ? 1 : 0;
    const bKindRank = bFrameType === "last" ? 1 : 0;
    if (aKindRank !== bKindRank) return aKindRank - bKindRank;
    return Number(a.frameIndex) - Number(b.frameIndex);
  });

  const tasks: FrameTask[] = [];
  for (const fp of selected) {
    const sceneId = String(fp.sceneId ?? "").trim() || null;
    const sceneNumber = Number.isFinite(Number(fp.sceneNumber))
      ? Number(fp.sceneNumber)
      : Number(fp.frameIndex);
    const frameType: "first" | "last" =
      fp.frameType === "last" || fp.promptKind === "last" ? "last" : "first";
    const frameIndex = Number.isFinite(Number(fp.frameIndex))
      ? Number(fp.frameIndex)
      : sceneNumber * 2 + (frameType === "last" ? 1 : 0);
    const frameKey = buildFrameIdempotencyKey({
      groupKey,
      frameIndex,
      sceneId,
      sceneNumber,
      frameType,
    });
    const out = await provider.createTask({
      storyboardId: args.storyboardId,
      idempotencyKey: frameKey,
      force: !!args.force,
      prompts: [
        {
          frameIndex,
          prompt: fp.prompt,
          negativePrompt: fp.negativePrompt,
          inputImageUrl: fp.inputImageUrl ?? null,
          previousSceneLastFrameImageUrl: fp.previousSceneLastFrameImageUrl ?? null,
          maskImageUrl: fp.maskImageUrl ?? null,
          width: fp.width,
          height: fp.height,
        },
      ],
      options: { taskGroupId, frameIndex, sceneId, sceneNumber, frameType },
    });

    tasks.push({
      frameIndex,
      sceneId,
      sceneNumber,
      frameType,
      promptKind: frameType,
      taskId: out.taskId,
      status: "QUEUED",
      url: null,
      error: null,
    });
  }

  return {
    providerId,
    idempotencyKey: groupKey,
    taskGroupId,
    tasks,
  };
}

export type PollMultiFrameArgs = {
  providerId?: ImageProviderId;
  tasks: FrameTask[];
};

export type PollMultiFrameResult = {
  providerId: ImageProviderId;
  tasks: FrameTask[];
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  images: Array<{
    frameIndex: number;
    sceneId: string | null;
    sceneNumber: number;
    frameType: "first" | "last";
    promptKind?: "first" | "last";
    url: string;
  }>;
  errorMessage?: string;
  raw: unknown;
};

function aggregateStatus(tasks: FrameTask[]): PollMultiFrameResult["status"] {
  if (tasks.some(t => t.status === "FAILED")) return "FAILED";
  if (tasks.every(t => t.status === "SUCCEEDED")) return "SUCCEEDED";
  if (tasks.some(t => t.status === "RUNNING")) return "RUNNING";
  return "QUEUED";
}

export async function pollMultiFrameVideoImages(args: PollMultiFrameArgs): Promise<PollMultiFrameResult> {
  const provider = getProvider(args.providerId);
  const providerId = provider.id;

  const maxConcurrency = Number(mustEnv("VIDEO_IMAGES_STATUS_CONCURRENCY", "4"));
  const tasks = [...args.tasks]
    .map((task): FrameTask => ({
      ...task,
      sceneId: String(task.sceneId ?? "").trim() || null,
      sceneNumber: Number.isFinite(Number(task.sceneNumber))
        ? Number(task.sceneNumber)
        : Number(task.frameIndex),
      frameType: task.frameType === "last" || task.promptKind === "last" ? "last" : "first",
      promptKind: task.frameType === "last" || task.promptKind === "last" ? "last" : "first",
    }))
    .sort((a, b) => {
      if (a.sceneNumber !== b.sceneNumber) return a.sceneNumber - b.sceneNumber;
      const aKindRank = a.frameType === "last" ? 1 : 0;
      const bKindRank = b.frameType === "last" ? 1 : 0;
      if (aKindRank !== bKindRank) return aKindRank - bKindRank;
      return a.frameIndex - b.frameIndex;
    });

  const next: FrameTask[] = [];
  const rawByTask: Record<string, unknown> = {};

  // simple concurrency limiter
  let i = 0;
  const workers = new Array(Math.min(maxConcurrency, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      const t = tasks[idx];
      // If already succeeded with url, skip polling.
      if (t.status === "SUCCEEDED" && t.url) {
        next[idx] = t;
        continue;
      }
      try {
        const s = await provider.getTask(t.taskId);
        rawByTask[t.taskId] = s.raw;

        const url = s.images?.[0]?.url ?? null;
        next[idx] = {
          ...t,
          status: s.status,
          url: url ?? t.url ?? null,
          error: s.status === "FAILED" ? (s.errorMessage ?? t.error ?? "KIE task failed") : null,
        };
      } catch (e: any) {
        next[idx] = {
          ...t,
          status: "FAILED",
          error: e?.message || "Polling failed",
        };
      }
    }
  });

  await Promise.all(workers);

  const status = aggregateStatus(next);
  const images = next
    .filter(t => t.status === "SUCCEEDED" && t.url)
    .map(t => ({
      frameIndex: t.frameIndex,
      sceneId: t.sceneId,
      sceneNumber: t.sceneNumber,
      frameType: t.frameType,
      promptKind: t.frameType,
      url: String(t.url),
    }))
    .sort((a, b) => {
      if (a.sceneNumber !== b.sceneNumber) return a.sceneNumber - b.sceneNumber;
      const aKindRank = a.frameType === "last" ? 1 : 0;
      const bKindRank = b.frameType === "last" ? 1 : 0;
      if (aKindRank !== bKindRank) return aKindRank - bKindRank;
      return a.frameIndex - b.frameIndex;
    });

  const errorMessage =
    status === "FAILED"
      ? next.find(t => t.status === "FAILED")?.error ?? "One or more frames failed"
      : undefined;

  return {
    providerId,
    tasks: next,
    status,
    images,
    errorMessage,
    raw: { perTask: rawByTask },
  };
}
