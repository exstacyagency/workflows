import { cfg } from "@/lib/config";
import prisma from "./prisma";
import { pollMultiFrameVideoImages } from "./videoImageOrchestrator";
import type { ImageProviderId } from "./imageProviders/types";
import { JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { uploadVideoFrameObject } from "@/lib/s3Service";

const KIE_HTTP_TIMEOUT_MS = Number(cfg.raw("KIE_HTTP_TIMEOUT_MS") ?? 20_000);
const KIE_POLL_INTERVAL_MS = Number(cfg.raw("KIE_POLL_INTERVAL_MS") ?? 2_000);
const JOB_MAX_RUNTIME_MS = Number(cfg.raw("WORKER_JOB_MAX_RUNTIME_MS") ?? 20 * 60_000);
const VIDEO_FRAMES_REQUIRE_S3 = String(cfg.raw("VIDEO_FRAMES_REQUIRE_S3") ?? "1") !== "0";

type RunArgs = {
  jobId: string;
  providerId?: ImageProviderId;
};

function inferImageExtension(args: { contentType: string | null; url: string }): string {
  const contentType = String(args.contentType ?? "").toLowerCase();
  if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return "jpg";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/avif")) return "avif";
  if (contentType.includes("image/gif")) return "gif";
  if (contentType.includes("image/png")) return "png";
  const cleanUrl = String(args.url ?? "").split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
  if (cleanUrl.endsWith(".webp")) return "webp";
  if (cleanUrl.endsWith(".avif")) return "avif";
  if (cleanUrl.endsWith(".gif")) return "gif";
  return "png";
}

async function persistFrameImageToS3(args: {
  projectId: string;
  storyboardId: string;
  sceneNumber: number;
  frameType: "first" | "last";
  version: number;
  sourceUrl: string;
}): Promise<string | null> {
  const sourceUrl = String(args.sourceUrl ?? "").trim();
  if (!sourceUrl) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      const message = `Failed to download generated frame for S3 upload (status=${res.status})`;
      if (VIDEO_FRAMES_REQUIRE_S3) {
        throw new Error(message);
      }
      console.warn("[VIG-SERVICE] " + message, { sourceUrl });
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    const contentTypeHeader = res.headers.get("content-type");
    const ext = inferImageExtension({ contentType: contentTypeHeader, url: sourceUrl });
    const contentType =
      contentTypeHeader && contentTypeHeader.toLowerCase().startsWith("image/")
        ? contentTypeHeader
        : ext === "jpg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : ext === "avif"
              ? "image/avif"
              : ext === "gif"
                ? "image/gif"
                : "image/png";
    const key = [
      "projects",
      args.projectId,
      "storyboards",
      args.storyboardId,
      "scenes",
      String(args.sceneNumber),
      args.frameType,
      `v${args.version}.${ext}`,
    ].join("/");
    const uploadedUrl = await uploadVideoFrameObject({
      key,
      body,
      contentType,
      cacheControl: "public,max-age=31536000,immutable",
    });
    if (!uploadedUrl) {
      const message = "S3 upload returned null (bucket/config unavailable or upload failed)";
      if (VIDEO_FRAMES_REQUIRE_S3) {
        throw new Error(message);
      }
      console.warn("[VIG-SERVICE] " + message, { key, sourceUrl });
      return null;
    }
    console.log("[VIG-SERVICE] Frame persisted to S3", {
      key,
      uploadedUrl,
      sceneNumber: args.sceneNumber,
      frameType: args.frameType,
    });
    return uploadedUrl;
  } catch (error: any) {
    if (VIDEO_FRAMES_REQUIRE_S3) {
      throw new Error(`S3 persistence failed: ${String(error?.message ?? error)}`);
    }
    console.warn("[VIG-SERVICE] S3 persistence failed, using source URL", {
      sourceUrl,
      error: String(error?.message ?? error),
    });
    return null;
  }
}

async function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: () => Promise<T>
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Worker entrypoint for VIDEO_IMAGE_GENERATION.
 * Nano Banana is single-image per task, so the Job.payload.tasks[] is the source of truth.
 * This function polls those tasks, updates Job, and persists StoryboardScene first/last URLs.
 */
export async function runVideoImageGenerationJob(args: RunArgs): Promise<void> {
  console.log("[VIG-SERVICE] runVideoImageGenerationJob called, jobId:", args.jobId);
  const startedAt = Date.now();
  const job = await prisma.job.findUnique({ where: { id: args.jobId } });
  if (!job) throw new Error(`Job not found: ${args.jobId}`);
  if (job.type !== "VIDEO_IMAGE_GENERATION") return;

  const payload = job.payload as any;
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  if (!tasks.length) {
    await updateJobStatus(job.id, JobStatus.FAILED);
    console.log("[VIG-SERVICE] DB update path: no-tasks -> prisma.job.update", {
      jobId: job.id,
    });
    const noTasksUpdateResult = await prisma.job.update({
      where: { id: job.id },
      data: {
        error: "Job payload has no tasks[]",
        resultSummary: "Video image generation failed",
      } as any,
    });
    console.log("[VIG-SERVICE] DB update complete: no-tasks", {
      jobId: noTasksUpdateResult.id,
      status: noTasksUpdateResult.status,
    });
    return;
  }

  const providerId = (args.providerId ?? payload?.providerId) as ImageProviderId | undefined;
  console.log("[VIG-SERVICE] About to poll KIE tasks");
  const result = await runWithTimeout(
    "VIDEO_IMAGE_GENERATION poll",
    KIE_HTTP_TIMEOUT_MS,
    () => pollMultiFrameVideoImages({ providerId, tasks })
  );
  console.log("[VIG-SERVICE] KIE polling returned, result:", result);
  const polled = result;

  const updatedPayload = {
    ...payload,
    providerId: polled.providerId,
    tasks: polled.tasks,
    result: { ok: true, status: polled.status, images: polled.images },
  };
  const normalizedPollStatus = String(polled.status ?? "").toUpperCase();
  const hasAnyFailedTask = polled.tasks.some(
    (task) => task.status === "FAILED" || Boolean(String(task.error ?? "").trim()),
  );
  const allTasksHaveUrls =
    polled.tasks.length > 0 &&
    polled.tasks.every((task) => Boolean(String(task.url ?? "").trim()));
  const isSuccessfulCompletion =
    normalizedPollStatus === "SUCCEEDED" ||
    normalizedPollStatus === "SUCCESS" ||
    (allTasksHaveUrls && !hasAnyFailedTask);
  const resolvedImages =
    polled.images.length > 0
      ? polled.images
      : polled.tasks
          .filter((task) => Boolean(String(task.url ?? "").trim()))
          .map((task) => ({
            frameIndex: Number(task.frameIndex),
            sceneId: String(task.sceneId ?? "").trim() || null,
            sceneNumber: Number.isFinite(Number(task.sceneNumber))
              ? Number(task.sceneNumber)
              : Number(task.frameIndex),
            frameType:
              task.frameType === "last" || task.promptKind === "last" ? ("last" as const) : ("first" as const),
            promptKind:
              task.frameType === "last" || task.promptKind === "last" ? ("last" as const) : ("first" as const),
            url: String(task.url ?? "").trim(),
          }))
          .filter((image) => Boolean(image.url));
  const taskStatusSnapshot = polled.tasks.map((task) => ({
    taskId: task.taskId,
    sceneNumber: task.sceneNumber,
    frameType: task.frameType ?? task.promptKind ?? "first",
    status: task.status,
    hasUrl: Boolean(String(task.url ?? "").trim()),
    error: String(task.error ?? "").trim() || null,
  }));

  console.log("[VIG-SERVICE] Completion evaluation start", {
    jobId: job.id,
    polledStatusRaw: polled.status,
    normalizedPollStatus,
    taskStatuses: taskStatusSnapshot,
    hasAnyFailedTask,
    allTasksHaveUrls,
    isSuccessfulCompletion,
    evaluatedConditions: {
      statusIsSucceeded: normalizedPollStatus === "SUCCEEDED",
      statusIsSuccess: normalizedPollStatus === "SUCCESS",
      allUrlsNoFailures: allTasksHaveUrls && !hasAnyFailedTask,
    },
  });

  if (Date.now() - startedAt > JOB_MAX_RUNTIME_MS) {
    throw new Error(`VIDEO_IMAGE_GENERATION exceeded max runtime ${JOB_MAX_RUNTIME_MS}ms`);
  }

  if (normalizedPollStatus === "FAILED") {
    console.log("[VIG-SERVICE] Completion path selected: failure", {
      jobId: job.id,
      normalizedPollStatus,
      errorMessage: polled.errorMessage ?? null,
    });
    await updateJobStatus(job.id, JobStatus.FAILED);
    console.log("[VIG-SERVICE] DB update path: failed-branch -> prisma.job.update", {
      jobId: job.id,
    });
    const failedUpdateResult = await prisma.job.update({
      where: { id: job.id },
      data: {
        error: polled.errorMessage ?? "One or more frames failed",
        payload: updatedPayload as any,
        resultSummary: "Video image generation failed",
      } as any,
    });
    console.log("[VIG-SERVICE] DB update complete: failed-branch", {
      jobId: failedUpdateResult.id,
      status: failedUpdateResult.status,
    });
    return;
  }

  if (isSuccessfulCompletion) {
    console.log("[VIG-SERVICE] Completion path selected: completed", {
      jobId: job.id,
      normalizedPollStatus,
      allTasksHaveUrls,
      hasAnyFailedTask,
    });
    console.log("[VIG-SERVICE] About to mark job COMPLETED, jobId:", job.id);
    await updateJobStatus(job.id, JobStatus.COMPLETED);
    console.log("[VIG-SERVICE] DB update path: completed-branch -> prisma.job.update", {
      jobId: job.id,
    });
    const completedUpdateResult = await prisma.job.update({
      where: { id: job.id },
      data: {
        error: null,
        payload: updatedPayload as any,
        resultSummary: `Video frames saved: ${resolvedImages.length}`,
      } as any,
    });
    console.log("[VIG-SERVICE] DB update complete: completed-branch", {
      jobId: completedUpdateResult.id,
      status: completedUpdateResult.status,
    });

    const storyboardId = payload?.storyboardId;
    if (storyboardId && resolvedImages.length > 0) {
      const s3Version = Date.now();
      const safePolledRaw = polled.raw && typeof polled.raw === "object" ? polled.raw : { value: polled.raw };
      const sceneRows = await prisma.storyboardScene.findMany({
        where: { storyboardId },
        select: {
          id: true,
          sceneNumber: true,
          rawJson: true,
        },
      });
      const sceneById = new Map<string, (typeof sceneRows)[number]>();
      const sceneByNumber = new Map<number, (typeof sceneRows)[number]>();
      for (const row of sceneRows) {
        sceneById.set(String(row.id), row);
        sceneByNumber.set(Number(row.sceneNumber), row);
      }

      const sceneImages = new Map<
        string,
        {
          sceneId: string | null;
          sceneNumber: number;
          firstFrameUrl: string | null;
          lastFrameUrl: string | null;
          images: Array<{
            frameIndex: number;
            sceneId: string | null;
            sceneNumber: number;
            frameType: "first" | "last";
            promptKind?: "first" | "last";
            url: string;
          }>;
        }
      >();
      for (const image of resolvedImages) {
        const sceneId = String((image as any).sceneId ?? "").trim() || null;
        const sceneNumber = Number.isFinite(Number(image.sceneNumber))
          ? Number(image.sceneNumber)
          : Number(image.frameIndex);
        const frameType: "first" | "last" =
          (image as any).frameType === "last" || (image as any).promptKind === "last"
            ? "last"
            : "first";
        if (!sceneId && !Number.isFinite(sceneNumber)) continue;
        const persistedUrl = await persistFrameImageToS3({
          projectId: String(job.projectId),
          storyboardId: String(storyboardId),
          sceneNumber: Number(sceneNumber),
          frameType,
          version: s3Version,
          sourceUrl: String(image.url),
        });
        const effectiveImageUrl = persistedUrl || String(image.url);
        const sceneKey = sceneId ? `id:${sceneId}` : `sceneNumber:${sceneNumber}`;
        const entry = sceneImages.get(sceneKey) ?? {
          sceneId,
          sceneNumber,
          firstFrameUrl: null,
          lastFrameUrl: null,
          images: [],
        };
        entry.images.push({
          ...image,
          url: effectiveImageUrl,
          sourceUrl: String(image.url),
        } as any);
        if (frameType === "last") {
          entry.lastFrameUrl = effectiveImageUrl;
        } else {
          entry.firstFrameUrl = effectiveImageUrl;
        }
        sceneImages.set(sceneKey, entry);
      }

      const updates = Array.from(sceneImages.values()).flatMap((generated) => {
        const row = generated.sceneId
          ? sceneById.get(generated.sceneId) ?? sceneByNumber.get(generated.sceneNumber)
          : sceneByNumber.get(generated.sceneNumber);
        if (!row) return [];
        const firstFrameUrl = generated.firstFrameUrl ?? null;
        const lastFrameUrl = generated.lastFrameUrl ?? generated.firstFrameUrl ?? null;
        const safePrev = row.rawJson && typeof row.rawJson === "object" ? row.rawJson : {};
        const sortedImages = [...generated.images].sort((a, b) => {
          const aKindRank =
            (a as any).frameType === "last" || (a as any).promptKind === "last" ? 1 : 0;
          const bKindRank =
            (b as any).frameType === "last" || (b as any).promptKind === "last" ? 1 : 0;
          if (aKindRank !== bKindRank) return aKindRank - bKindRank;
          return a.frameIndex - b.frameIndex;
        });

        return [
          prisma.storyboardScene.update({
            where: { id: row.id },
            data: {
              firstFrameImageUrl: firstFrameUrl,
              lastFrameImageUrl: lastFrameUrl,
              rawJson: {
                ...safePrev,
                polled: safePolledRaw,
                images: sortedImages,
                firstFrameImageUrl: firstFrameUrl,
                lastFrameImageUrl: lastFrameUrl,
                firstFrameS3Url: firstFrameUrl,
                lastFrameS3Url: lastFrameUrl,
                frameStorageVersion: s3Version,
              } as any,
              status: "completed" as any,
            } as any,
          }),
        ];
      });

      if (updates.length > 0) {
        await prisma.$transaction(updates);
      }
    }
    return;
  }

  // Still running: requeue without nextRunAt so the worker can claim immediately.
  // Clear stale nextRunAt from older payloads to avoid delayed re-claims.
  console.log("[VIG-SERVICE] Completion path selected: requeue", {
    jobId: job.id,
    normalizedPollStatus,
    allTasksHaveUrls,
    hasAnyFailedTask,
  });
  const pendingPayload = { ...updatedPayload } as Record<string, unknown>;
  delete pendingPayload.nextRunAt;
  console.log("[VIG-SERVICE] DB update path: requeue -> prisma.job.update", {
    jobId: job.id,
  });
  console.log("[VIG-SERVICE] Setting nextRunAt to:", pendingPayload.nextRunAt);
  const updateResult = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: JobStatus.PENDING,
      error: null,
      payload: pendingPayload as any,
      resultSummary: `Video frames in progress: ${polled.images.length}/${polled.tasks.length}`,
    } as any,
  });
  console.log("[VIG-SERVICE] Job status updated to PENDING in DB");
  console.log("[VIG-SERVICE] Update result:", updateResult);
}
