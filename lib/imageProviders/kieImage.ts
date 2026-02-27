import { cfg } from "@/lib/config";
import { kieJobPathsFromEnv, kieRequest } from "@/lib/kie/kieHttp";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  VideoImageProvider,
  CreateVideoImagesInput,
  CreateVideoImagesOutput,
  GetTaskOutput,
  ImageProviderId,
} from "./types";

export const MAX_POLL_ATTEMPTS = 180;
export const POLL_INTERVAL_MS = 3_000;
const KIE_SPEND_CONFIRM_HEADERS = { "x-kie-spend-confirm": "1" } as const;

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

function isAwsS3HttpUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\.s3[.-][^/]*amazonaws\.com\/.+/i.test(url);
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

    const continuityReferenceUrl = input.prompts[0]?.previousSceneLastFrameImageUrl
      ? String(input.prompts[0].previousSceneLastFrameImageUrl).trim()
      : "";
    const primaryInputImageUrl = input.prompts[0]?.inputImageUrl
      ? String(input.prompts[0].inputImageUrl).trim()
      : "";
    const extraReferenceUrls = Array.isArray(input.prompts[0]?.referenceImageUrls)
      ? input.prompts[0].referenceImageUrls
          .map((url) => String(url ?? "").trim())
          .filter(Boolean)
      : [];
    // Ordered image inputs for first-frame generation:
    // 1) Previous-scene continuity frame
    // 2) Creator avatar anchor
    // 3) Product anchor / additional references
    const imageInputUrls = Array.from(
      new Set(
        [
          continuityReferenceUrl,
          primaryInputImageUrl,
          ...extraReferenceUrls,
        ].filter((url): url is string => typeof url === "string" && url.length > 0),
      ),
    );
    const awsRegion =
      cfg.raw("AWS_REGION")?.trim() ||
      cfg.raw("AWS_S3_REGION")?.trim() ||
      "us-east-2";
    const s3 = new S3Client({
      region: awsRegion,
    });
    const presignedImageInputUrls = await Promise.all(
      imageInputUrls.map(async (url) => {
        try {
          if (!isAwsS3HttpUrl(url)) {
            return url;
          }
          const parsed = new URL(url);
          const bucket = parsed.hostname.split(".")[0];
          const key = parsed.pathname.slice(1);
          return await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 3600 }
          );
        } catch {
          return url; // non-S3 URLs pass through unchanged
        }
      })
    );

    const payload = {
      model: this.model,
      input: {
        prompt: firstPrompt,
        ...(presignedImageInputUrls.length > 0
          ? { image_input: presignedImageInputUrls }
          : {}),
        aspect_ratio: "9:16",
        resolution: "2K",
        output_format: "png",
      },
    };

    const { status, json, text } = await kieRequest<any>(
      "POST",
      createPath,
      payload,
      KIE_SPEND_CONFIRM_HEADERS,
    );

    const taskId = json?.data?.taskId ?? json?.taskId ?? json?.data?.id ?? null;
    if (!taskId) {
      const msg = json?.msg || json?.message || "KIE createTask did not return taskId";
      throw new Error(
        `KIE createTask missing taskId. msg="${msg}". ` +
          `Check KIE_API_BASE_URL/KIE_CREATE_PATH (must be API endpoints). ` +
          `Raw=${String(text).slice(0, 800)}`
      );
    }

    return {
      taskId: String(taskId),
      raw: json,
      httpStatus: status,
      responseText: text,
    };
  }

  async getTask(taskId: string): Promise<GetTaskOutput> {
    const { statusPath } = kieJobPathsFromEnv();

    const path = statusPath.includes("taskId=")
      ? `${statusPath}${encodeURIComponent(taskId)}`
      : `${statusPath.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;

    const { status: httpStatus, json, text } = await kieRequest<any>(
      "GET",
      path,
      undefined,
      KIE_SPEND_CONFIRM_HEADERS,
    );

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
      httpStatus,
      responseText: text,
    };
  }
}
