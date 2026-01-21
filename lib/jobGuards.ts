import { cfg } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { JobStatus, JobType } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";

const MAX_RUNNING_JOBS_PER_USER = Number(
  cfg.raw("MAX_RUNNING_JOBS_PER_USER") ?? 3
);
const MAX_ATTEMPTS = Number(cfg.raw("MAX_JOB_ATTEMPTS") ?? 3);

export function computeBackoffMs(attempt: number) {
  const base = 1000;
  const max = 60_000;
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

export async function enforceUserConcurrency(userId: string) {
  const running = await prisma.job.count({
    where: {
      project: { userId },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
  });
  if (running >= MAX_RUNNING_JOBS_PER_USER) {
    return {
      allowed: false as const,
      reason: `Too many running jobs (max ${MAX_RUNNING_JOBS_PER_USER})`,
    };
  }
  return { allowed: true as const };
}

export async function findIdempotentJob(params: {
  projectId: string;
  type: JobType;
  idempotencyKey: string;
}) {
  const { projectId, type, idempotencyKey } = params;

  return prisma.job.findFirst({
    where: {
      projectId,
      type,
      payload: {
        path: ["idempotencyKey"],
        equals: idempotencyKey,
      },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createJobWithIdempotency(params: {
  userId: string;
  projectId: string;
  type: JobType;
  idempotencyKey: string;
  payload?: Record<string, any>;
}) {
  const { userId, projectId, type, idempotencyKey, payload } = params;

  const existing = await findIdempotentJob({
    projectId,
    type,
    idempotencyKey,
  });
  if (existing) return { job: existing, reused: true as const };

  const job = await prisma.job.create({
    data: {
      projectId,
      userId,
      type,
      status: JobStatus.PENDING,
      idempotencyKey,
      payload: { ...(payload ?? {}), idempotencyKey },
    },
  });

  return { job, reused: false as const };
}

export async function markJobStatus(
  jobId: string,
  next: JobStatus,
  error?: string | null
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  await updateJobStatus(jobId, next);

  return prisma.job.update({
    where: { id: jobId },
    data: {
      error: error ?? (next === JobStatus.FAILED ? "Job failed" : null),
    },
  });
}

export async function recordAttempt(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  const payload = (job.payload as any) ?? {};
  const attempts = Number(payload.attempts ?? 0) + 1;
  const backoffMs = computeBackoffMs(attempts);

  if (attempts > MAX_ATTEMPTS) {
    await markJobStatus(jobId, JobStatus.FAILED, "Max attempts exceeded");
    return { attempts, backoffMs, shouldRetry: false as const };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      payload: { ...payload, attempts, nextRunAt: Date.now() + backoffMs },
    },
  });

  return { attempts, backoffMs, shouldRetry: true as const };
}
