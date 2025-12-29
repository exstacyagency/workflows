import { prisma } from "@/lib/prisma";
import { cfg } from "@/lib/config";
import { isSelfHosted } from "@/lib/config/mode";
import { JobStatus, JobType } from "@prisma/client";

export type EnqueueJobInput = {
  projectId: string;
  type: JobType;
  payload: Record<string, any>;
  idempotencyKey?: string;
};

function getQueueBackend(): "db" | "redis" {
  // Self-host defaults to DB queue unless explicitly overridden.
  if (isSelfHosted()) return (cfg.raw("QUEUE_BACKEND") as any) === "redis" ? "redis" : "db";
  return (cfg.raw("QUEUE_BACKEND") as any) === "redis" ? "redis" : "db";
}

function assertRedisConfigured() {
  const url = (cfg.raw("REDIS_URL") ?? "").trim();
  if (!url) {
    throw new Error("QUEUE_BACKEND=redis requires REDIS_URL to be set");
  }
  return url;
}

/**
 * Enqueue a job for background processing.
 *
 * DB backend: writes a Job row (PENDING) which your DB poller worker consumes.
 * Redis backend: (optional) if you have Redis worker wiring, implement here.
 *
 * This function is intentionally idempotency-aware (best-effort).
 */
export async function enqueueJob(
  input: EnqueueJobInput
): Promise<{ jobId: string; reused: boolean }> {
  const backend = getQueueBackend();

  if (backend === "db") {
    if (input.idempotencyKey) {
      const existing = await prisma.job.findFirst({
        where: {
          projectId: input.projectId,
          type: input.type,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.job.update({
          where: { id: existing.id },
          data: {
            status: JobStatus.PENDING,
            error: null,
            payload: input.payload,
          },
        });
        return { jobId: existing.id, reused: true };
      }
    }

    const job = await prisma.job.create({
      data: {
        projectId: input.projectId,
        type: input.type,
        status: JobStatus.PENDING,
        idempotencyKey: input.idempotencyKey ?? null,
        payload: input.payload,
      },
      select: { id: true },
    });
    return { jobId: job.id, reused: false };
  }

  // Redis backend (fail-fast if not configured).
  assertRedisConfigured();
  throw new Error(
    "QUEUE_BACKEND=redis is selected but Redis enqueue is not implemented in lib/queue/enqueue.ts. " +
      "Either set QUEUE_BACKEND=db or implement Redis queue wiring."
  );
}
