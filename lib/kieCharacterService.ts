import { cfg } from "@/lib/config";
import { kieJobPathsFromEnv, kieRequest } from "@/lib/kie/kieHttp";

type CreateTaskResponse = {
  data?: {
    id?: string;
    taskId?: string;
  };
  id?: string;
  taskId?: string;
  msg?: string;
  message?: string;
};

type PollTaskResponse = {
  data?: Record<string, unknown>;
  result?: Record<string, unknown>;
  [key: string]: unknown;
};

type PollResult = {
  state: "RUNNING" | "SUCCEEDED" | "FAILED";
  videoUrl: string | null;
  characterId: string | null;
  characterUserName: string | null;
  raw: PollTaskResponse | string;
};

const DEFAULT_INTERVAL_MS = Number(cfg.raw("KIE_CHARACTER_POLL_INTERVAL_MS") ?? 5_000);
const DEFAULT_MAX_ATTEMPTS = Number(cfg.raw("KIE_CHARACTER_POLL_ATTEMPTS") ?? 120);

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return null;
}

function unwrapData(response: PollTaskResponse): Record<string, unknown> {
  return asObject(response.data);
}

function extractVideoUrl(response: PollTaskResponse): string | null {
  const data = unwrapData(response);
  const result = asObject(data.result);

  const resultUrls = data.resultUrls;
  if (Array.isArray(resultUrls)) {
    const first = pickString(...resultUrls);
    if (first) return first;
  }

  const nestedResultUrls = result.resultUrls;
  if (Array.isArray(nestedResultUrls)) {
    const first = pickString(...nestedResultUrls);
    if (first) return first;
  }

  return pickString(
    data.videoUrl,
    data.video_url,
    result.videoUrl,
    result.video_url,
    result.url,
    data.url,
    asObject(response.result).videoUrl,
    asObject(response.result).video_url,
    asObject(response.result).url,
  );
}

function extractCharacterId(response: PollTaskResponse): string | null {
  const data = unwrapData(response);
  const result = asObject(data.result);
  return pickString(
    data.character_id,
    data.characterId,
    result.character_id,
    result.characterId,
    asObject(response.result).character_id,
    asObject(response.result).characterId,
  );
}

function extractCharacterUserName(response: PollTaskResponse): string | null {
  const data = unwrapData(response);
  const result = asObject(data.result);
  return pickString(
    data.character_user_name,
    data.characterUserName,
    data.user_name,
    data.username,
    result.character_user_name,
    result.characterUserName,
    result.user_name,
    result.username,
    asObject(response.result).character_user_name,
    asObject(response.result).characterUserName,
  );
}

export function normalizeState(response: PollTaskResponse): "RUNNING" | "SUCCEEDED" | "FAILED" {
  const data = unwrapData(response);
  const rawState = pickString(
    data.state,
    data.status,
    data.taskStatus,
    data.task_status,
    asObject(data.result).status,
    asObject(response.result).status,
    (response as Record<string, unknown>).status,
  );

  const normalized = String(rawState ?? "").toLowerCase();
  if (["success", "succeeded", "completed", "complete", "done"].includes(normalized)) {
    return "SUCCEEDED";
  }
  if (["failed", "fail", "error", "canceled", "cancelled"].includes(normalized)) {
    return "FAILED";
  }
  return "RUNNING";
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTask(
  payload: Record<string, unknown>,
  logLabel = "[KIE createTask] payload:",
): Promise<string> {
  const { createPath } = kieJobPathsFromEnv();
  console.log(logLabel, JSON.stringify(payload, null, 2));
  const { json, text } = await kieRequest<CreateTaskResponse>("POST", createPath, payload, {
    "x-kie-spend-confirm": "1",
  });
  const taskId =
    pickString(json?.data?.taskId, json?.data?.id, json?.taskId, json?.id) ?? null;
  if (!taskId) {
    throw new Error(`KIE createTask missing taskId: ${String(text).slice(0, 1000)}`);
  }
  return taskId;
}

export async function getTask(taskId: string): Promise<PollTaskResponse | string> {
  const { statusPath } = kieJobPathsFromEnv();
  const path = statusPath.includes("taskId=")
    ? `${statusPath}${encodeURIComponent(taskId)}`
    : `${statusPath.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
  const { json, text } = await kieRequest<PollTaskResponse>("GET", path, undefined, {
    "x-kie-spend-confirm": "1",
  });
  return json ?? text;
}

export async function createCharacterAvatarImage(args: {
  prompt: string;
}): Promise<{ taskId: string }> {
  const model = cfg.raw("KIE_CHARACTER_IMAGE_MODEL") || "nano-banana-2";
  const payload: Record<string, unknown> = {
    model,
    input: {
      prompt: args.prompt,
      aspect_ratio: "2:3",
      resolution: "2K",
      output_format: "png",
    },
  };

  const taskId = await createTask(payload, "[KIE createCharacterAvatarImage] payload:");
  return { taskId };
}

export function extractImageUrl(response: PollTaskResponse): string | null {
  const data = unwrapData(response);
  const result = asObject(data.result);
  const rootResult = asObject(response.result);

  let parsedResultJson: Record<string, unknown> = {};
  try {
    const rawResultJson = data.resultJson ?? result.resultJson ?? rootResult.resultJson;
    parsedResultJson =
      typeof rawResultJson === "string"
        ? asObject(JSON.parse(rawResultJson))
        : asObject(rawResultJson);
  } catch {
    parsedResultJson = {};
  }

  const parsedResultObject = asObject(parsedResultJson.resultObject);

  return pickString(
    data.imageUrl,
    data.image_url,
    data.url,
    result.imageUrl,
    result.image_url,
    result.url,
    rootResult.imageUrl,
    rootResult.image_url,
    rootResult.url,
    parsedResultJson.imageUrl,
    parsedResultJson.image_url,
    parsedResultJson.url,
    parsedResultObject.imageUrl,
    parsedResultObject.image_url,
    parsedResultObject.url,
    Array.isArray(data.resultUrls) ? data.resultUrls[0] : null,
    Array.isArray(result.resultUrls) ? result.resultUrls[0] : null,
    Array.isArray(rootResult.resultUrls) ? rootResult.resultUrls[0] : null,
    Array.isArray(parsedResultJson.resultUrls) ? parsedResultJson.resultUrls[0] : null,
    Array.isArray(parsedResultObject.resultUrls) ? parsedResultObject.resultUrls[0] : null,
  );
}

export async function createCharacter(args: {
  originTaskId: string;
  characterPrompt: string;
}): Promise<{ taskId: string }> {
  const model = cfg.raw("KIE_CHARACTER_REFERENCE_MODEL") || "sora-2-characters-pro";
  const payload: Record<string, unknown> = {
    model,
    input: {
      origin_task_id: args.originTaskId,
      character_prompt: args.characterPrompt,
      timestamps: "1.0,4.0",
      remove_watermark: true,
      upload_method: "s3",
    },
  };
  const taskId = await createTask(payload);
  return { taskId };
}

export async function pollKieTask(args: {
  taskId: string;
  intervalMs?: number;
  maxAttempts?: number;
}): Promise<PollResult> {
  const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = await getTask(args.taskId);
    const normalizedRaw = typeof raw === "string" ? raw : (raw as PollTaskResponse);
    console.log("[KIE pollKieTask] attempt", attempt, "response:", JSON.stringify(normalizedRaw));
    if (typeof normalizedRaw === "string") {
      await sleep(intervalMs);
      continue;
    }

    const state = normalizeState(normalizedRaw);
    const videoUrl = extractVideoUrl(normalizedRaw);
    const characterId = extractCharacterId(normalizedRaw);
    const characterUserName = extractCharacterUserName(normalizedRaw);

    if (state === "SUCCEEDED") {
      return { state, videoUrl, characterId, characterUserName, raw: normalizedRaw };
    }
    if (state === "FAILED") {
      return { state, videoUrl, characterId, characterUserName, raw: normalizedRaw };
    }
    await sleep(intervalMs);
  }

  throw new Error("KIE task polling timed out");
}
