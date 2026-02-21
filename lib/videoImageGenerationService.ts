import { cfg } from "@/lib/config";
import prisma from "./prisma";
import { pollMultiFrameVideoImages } from "./videoImageOrchestrator";
import type { ImageProviderId } from "./imageProviders/types";
import { JobStatus } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";

const KIE_HTTP_TIMEOUT_MS = Number(cfg.raw("KIE_HTTP_TIMEOUT_MS") ?? 20_000);
const KIE_POLL_INTERVAL_MS = Number(cfg.raw("KIE_POLL_INTERVAL_MS") ?? 2_000);
const JOB_MAX_RUNTIME_MS = Number(cfg.raw("WORKER_JOB_MAX_RUNTIME_MS") ?? 20 * 60_000);

type RunArgs = {
  jobId: string;
  providerId?: ImageProviderId;
};

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
        resultSummary: `Video frames saved: ${polled.images.length}`,
      } as any,
    });
    console.log("[VIG-SERVICE] DB update complete: completed-branch", {
      jobId: completedUpdateResult.id,
      status: completedUpdateResult.status,
    });

    const storyboardId = payload?.storyboardId;
    if (storyboardId && polled.images.length > 0) {
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
          images: typeof polled.images;
        }
      >();
      for (const image of polled.images) {
        const sceneId = String((image as any).sceneId ?? "").trim() || null;
        const sceneNumber = Number.isFinite(Number(image.sceneNumber))
          ? Number(image.sceneNumber)
          : Number(image.frameIndex);
        const frameType: "first" | "last" =
          (image as any).frameType === "last" || (image as any).promptKind === "last"
            ? "last"
            : "first";
        if (!sceneId && !Number.isFinite(sceneNumber)) continue;
        const sceneKey = sceneId ? `id:${sceneId}` : `sceneNumber:${sceneNumber}`;
        const entry = sceneImages.get(sceneKey) ?? {
          sceneId,
          sceneNumber,
          firstFrameUrl: null,
          lastFrameUrl: null,
          images: [],
        };
        entry.images.push(image);
        if (frameType === "last") {
          entry.lastFrameUrl = image.url;
        } else {
          entry.firstFrameUrl = image.url;
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
