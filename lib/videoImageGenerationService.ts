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
  const startedAt = Date.now();
  const job = await prisma.job.findUnique({ where: { id: args.jobId } });
  if (!job) throw new Error(`Job not found: ${args.jobId}`);
  if (job.type !== "VIDEO_IMAGE_GENERATION") return;

  const payload = job.payload as any;
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  if (!tasks.length) {
    await updateJobStatus(job.id, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        error: "Job payload has no tasks[]",
        resultSummary: "Video image generation failed",
      } as any,
    });
    return;
  }

  const providerId = (args.providerId ?? payload?.providerId) as ImageProviderId | undefined;
  const polled = await runWithTimeout(
    "VIDEO_IMAGE_GENERATION poll",
    KIE_HTTP_TIMEOUT_MS,
    () => pollMultiFrameVideoImages({ providerId, tasks })
  );

  const updatedPayload = {
    ...payload,
    providerId: polled.providerId,
    tasks: polled.tasks,
    result: { ok: true, status: polled.status, images: polled.images },
  };

  if (Date.now() - startedAt > JOB_MAX_RUNTIME_MS) {
    throw new Error(`VIDEO_IMAGE_GENERATION exceeded max runtime ${JOB_MAX_RUNTIME_MS}ms`);
  }

  if (polled.status === "FAILED") {
    await updateJobStatus(job.id, JobStatus.FAILED);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        error: polled.errorMessage ?? "One or more frames failed",
        payload: updatedPayload as any,
        resultSummary: "Video image generation failed",
      } as any,
    });
    return;
  }

  if (polled.status === "SUCCEEDED") {
    await updateJobStatus(job.id, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        error: null,
        payload: updatedPayload as any,
        resultSummary: `Video frames saved: ${polled.images.length}`,
      } as any,
    });

    const storyboardId = payload?.storyboardId;
    if (storyboardId && polled.images.length > 0) {
      const sorted = [...polled.images].sort((a, b) => a.frameIndex - b.frameIndex);
      const firstUrl = sorted[0].url;
      const lastUrl = sorted.length > 1 ? sorted[sorted.length - 1].url : sorted[0].url;

      const safePrev = payload?.rawJson && typeof payload.rawJson === "object" ? payload.rawJson : {};
      const safePolledRaw = polled.raw && typeof polled.raw === "object" ? polled.raw : { value: polled.raw };

      await prisma.storyboardScene.updateMany({
        where: { storyboardId },
        data: {
          firstFrameUrl: firstUrl,
          lastFrameUrl: lastUrl,
          rawJson: { ...safePrev, polled: safePolledRaw, images: sorted } as any,
          status: "completed" as any,
        } as any,
      });
    }
    return;
  }

  // Still running
  await updateJobStatus(job.id, JobStatus.RUNNING);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      error: null,
      payload: { ...updatedPayload, nextRunAt: Date.now() + KIE_POLL_INTERVAL_MS } as any,
      resultSummary: `Video frames in progress: ${polled.images.length}/${polled.tasks.length}`,
    } as any,
  });
}
