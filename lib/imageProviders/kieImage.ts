import { cfg } from "@/lib/config";
import { kieJobPathsFromEnv, kieRequest } from "@/lib/kie/kieHttp";
import type {
  VideoImageProvider,
  CreateVideoImagesInput,
  CreateVideoImagesOutput,
  GetTaskOutput,
  ImageProviderId,
} from "./types";

function normalizeStatus(s: any): GetTaskOutput["status"] {
  const v = String(s ?? "").toUpperCase();
  if (["QUEUE", "QUEUED", "PENDING"].includes(v)) return "QUEUED";
  if (["RUNNING", "PROCESSING"].includes(v)) return "RUNNING";
  if (["SUCCESS", "SUCCEEDED", "DONE", "COMPLETED"].includes(v)) return "SUCCEEDED";
  if (["FAIL", "FAILED", "ERROR"].includes(v)) return "FAILED";
  return "RUNNING";
}

function unwrapKieData(json: any): any {
  // KIE commonly returns { code, msg, data: {...} }.
  // Some variants nest again: { code, msg, data: { data: {...} } }.
  const d1 = json?.data;
  const d2 = d1?.data;
  // Prefer deeper "data" only if it looks like a real object (not arrays/strings).
  if (d2 && typeof d2 === "object" && !Array.isArray(d2)) return d2;
  if (d1 && typeof d1 === "object" && !Array.isArray(d1)) return d1;
  return json;
}

function safeParseJsonString(s: any): any | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function extractImagesFromKie(json: any): Array<{ frameIndex: number; url: string }> {
  const root = unwrapKieData(json);

  // KIE recordInfo returns resultJson as a string:
  // e.g. {"resultUrls":["https://...png"]}
  const parsedResultJson = safeParseJsonString(root?.resultJson);
  const resultUrls: string[] | null = Array.isArray(parsedResultJson?.resultUrls)
    ? parsedResultJson.resultUrls
    : null;
  if (resultUrls && resultUrls.length) {
    return resultUrls
      .filter((u) => typeof u === "string" && u.trim())
      .map((u, idx) => ({ frameIndex: idx, url: u.trim() }));
  }

  const candidates =
    root?.images ??
    root?.result?.images ??
    root?.output?.images ??
    root?.outputs ??
    root?.result ??
    root?.output ??
    [];

  // If result is a single object (common), normalize to array-of-one for extraction attempts
  const arr = Array.isArray(candidates) ? candidates : [candidates].filter(Boolean);

  return arr
    .flatMap((img: any) => {
      // Try multiple known shapes:
      const inner =
        img?.images ??
        img?.data?.images ??
        img?.output?.images ??
        img?.result?.images ??
        null;

      const list = Array.isArray(inner) ? inner : [img];
      return list;
    })
    .map((img: any) => ({
      frameIndex: Number(img?.frameIndex ?? img?.index ?? img?.frame_index ?? 0),
      url: String(img?.url ?? img?.imageUrl ?? img?.image_url ?? ""),
    }))
    .filter((x) => x.url);
}

function extractSingleResultUrl(json: any): string | null {
  const root = unwrapKieData(json);

  const parsedResultJson = safeParseJsonString(root?.resultJson);
  const firstFromResultUrls =
    Array.isArray(parsedResultJson?.resultUrls) && parsedResultJson.resultUrls[0]
      ? String(parsedResultJson.resultUrls[0]).trim()
      : null;
  if (firstFromResultUrls) return firstFromResultUrls;

  const url =
    root?.resultUrl ??
    root?.result_url ??
    root?.url ??
    root?.imageUrl ??
    root?.image_url ??
    root?.result?.url ??
    root?.output?.url ??
    root?.output_url ??
    root?.result?.imageUrl ??
    root?.result?.image_url ??
    null;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function hasAnyKieOutput(json: any): boolean {
  const root = unwrapKieData(json);
  const parsedResultJson = safeParseJsonString(root?.resultJson);
  if (Array.isArray(parsedResultJson?.resultUrls) && parsedResultJson.resultUrls.length > 0) return true;
  // If any of these exist, the job is effectively done even if status fields are weird.
  const out =
    root?.images ??
    root?.result ??
    root?.output ??
    root?.outputs ??
    root?.resultUrl ??
    root?.result_url ??
    root?.url ??
    root?.imageUrl ??
    root?.image_url ??
    null;
  if (!out) return false;
  if (Array.isArray(out)) return out.length > 0;
  if (typeof out === "object") return Object.keys(out).length > 0;
  if (typeof out === "string") return out.length > 0;
  return false;
}

function pickFirstDefined<T>(...vals: T[]): T | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

export class KieImageProvider implements VideoImageProvider {
  id: ImageProviderId;
  private model: string;

  constructor(args: { id: ImageProviderId; model: string }) {
    this.id = args.id;
    this.model = args.model;
  }

  async createTask(input: CreateVideoImagesInput): Promise<CreateVideoImagesOutput> {
    if (cfg.raw("KIE_LIVE_MODE") !== "1") {
      throw new Error(
        "KIE live mode is disabled. Set KIE_LIVE_MODE=1 to allow paid image generation."
      );
    }
    const { createPath } = kieJobPathsFromEnv();

    // Nano Banana Pro (and similar single-image models) are single-image-per-task.
    // Enforce 1 prompt per task. Multi-frame orchestration happens at the service layer.
    if (!input.prompts || input.prompts.length !== 1) {
      throw new Error(`Invalid input: createTask requires exactly 1 prompt (got ${input.prompts?.length ?? 0})`);
    }

    const firstPrompt = input.prompts[0]?.prompt?.trim() ?? "";
    if (!firstPrompt) {
      throw new Error(`Invalid input: prompts[0].prompt is required`);
    }

    const firstNegative = input.prompts[0]?.negativePrompt?.trim() ?? "";
    const frameIndex = Number(input.prompts[0]?.frameIndex ?? 0);

    const payload = {
      model: this.model,
      idempotencyKey: input.idempotencyKey,
      force: !!input.force,
      // Some KIE jobs schemas require prompt at the top level.
      prompt: firstPrompt,
      negative_prompt: firstNegative || undefined,
      input: {
        // Many KIE schemas require input.prompt specifically.
        prompt: firstPrompt,
        negative_prompt: firstNegative || undefined,
        storyboardId: input.storyboardId,
        frames: input.prompts.map((p) => ({
          frameIndex: p.frameIndex,
          // KIE commonly uses snake_case keys.
          prompt: (p.prompt ?? "").trim(),
          negative_prompt: (p.negativePrompt ?? "").trim() || undefined,
          inputImageUrl: p.inputImageUrl ?? null,
          maskImageUrl: p.maskImageUrl ?? null,
          width: p.width,
          height: p.height,
        })),
        options: input.options ?? {},
      },
    };

    const { json, text } = await kieRequest<any>("POST", createPath, payload);

    const taskId = json?.data?.taskId ?? json?.taskId ?? json?.data?.id ?? null;
    if (!taskId) {
      const msg = json?.msg || json?.message || "KIE createTask did not return taskId";
      throw new Error(
        `KIE createTask missing taskId. msg="${msg}". ` +
          `Check KIE_API_BASE_URL/KIE_CREATE_PATH (must be API endpoints). ` +
          `Raw=${String(text).slice(0, 800)}`
      );
    }

    return { taskId: String(taskId), raw: json };
  }

  async getTask(taskId: string): Promise<GetTaskOutput> {
    const { statusPath } = kieJobPathsFromEnv();

    const path = statusPath.includes("taskId=")
      ? `${statusPath}${encodeURIComponent(taskId)}`
      : `${statusPath.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;

    const { json, text } = await kieRequest<any>("GET", path);

    let images = extractImagesFromKie(json);
    if (images.length === 0) {
      const single = extractSingleResultUrl(json);
      if (single) images = [{ frameIndex: 0, url: single }];
    }

    // For single-image-per-task models, preserve the task's frameIndex if KIE doesn't provide it.
    // If caller stored frameIndex elsewhere, it should rewrite after aggregation.
    // (Leave as-is if KIE did return frameIndex.)

    // KIE sometimes indicates completion by result presence even if status fields are missing/odd.
    // Priority:
    // 1) If output images exist => SUCCEEDED
    // 2) Else normalize from any likely status field
    const rawStatus = pickFirstDefined(
      unwrapKieData(json)?.status,
      unwrapKieData(json)?.state,
      unwrapKieData(json)?.taskStatus,
      unwrapKieData(json)?.task_status,
      unwrapKieData(json)?.result?.status
    );

    const status: GetTaskOutput["status"] =
      images.length > 0 || hasAnyKieOutput(json) ? "SUCCEEDED" : normalizeStatus(rawStatus);

    // Only surface an error message when FAILED. Do NOT treat msg="success" as an error.
    const errorMessage =
      status === "FAILED"
        ? (pickFirstDefined(
            json?.data?.errorMessage,
            json?.errorMessage,
            json?.data?.error,
            json?.error,
            json?.data?.msg,
            json?.msg,
            json?.data?.message,
            json?.message
          ) as string | undefined)
        : undefined;

    return {
      status,
      images: images.length ? images : undefined,
      errorMessage,
      raw: json ?? text,
    };
  }
}
