import type { RuntimeMode } from "./jobRuntimeMode";

export function isBeta(mode: RuntimeMode) {
  return mode === "beta";
}
import { prisma } from "./prisma.ts";
import { JobStatus, Prisma } from "@prisma/client";
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { getRuntimeMode } from "./jobRuntimeMode";

type Payload = Record<string, any>;

export async function setStatus(jobId: string, next: JobStatus, error?: string | null) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) throw new Error("Job not found");

  await updateJobStatus(jobId, next);
  return prisma.job.update({
    where: { id: jobId },
    data: { error: error ?? (next === JobStatus.FAILED ? "Job failed" : Prisma.JsonNull) },
  });
}

export async function getRetryState(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  const payload = (job.payload as Payload) ?? {};
  const attempts = Number(payload.attempts ?? 0);
  const nextRunAt = payload.nextRunAt ? Number(payload.nextRunAt) : null;

  return { job, payload, attempts, nextRunAt };
}

export async function recordFailureForRetry(jobId: string, errMsg: string) {
  const { job, payload } = await getRetryState(jobId);
  const attempts = Number(payload.attempts ?? 0) + 1;

  if (job.status === JobStatus.FAILED || job.status === JobStatus.COMPLETED) {
    return { willRetry: false, attempts, backoffMs: null };
  }

  await updateJobStatus(jobId, JobStatus.FAILED);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      error: errMsg,
      payload: {
        ...payload,
        attempts,
        lastError: errMsg,
        nextRunAt: null,
      },
    },
  });

  return { willRetry: false, attempts, backoffMs: null };
}

export async function runWithState(jobId: string, fn: () => Promise<any>) {
  const { job, payload, attempts, nextRunAt } = await getRetryState(jobId);

  if (job.status === JobStatus.COMPLETED) {
    return { ok: true, result: null, skipped: "already_completed" as const };
  }

  if (nextRunAt && Date.now() < nextRunAt) {
    return { ok: false, result: null, skipped: "backoff_active" as const, nextRunAt };
  }

  if (job.status !== JobStatus.PENDING && job.status !== JobStatus.RUNNING) {
    throw new Error(`Invalid job state for execution: ${job.status}`);
  }

  if (job.status === JobStatus.PENDING) {
    await updateJobStatus(jobId, JobStatus.RUNNING);
    await prisma.job.update({ where: { id: jobId }, data: { error: Prisma.JsonNull } });
  }

  try {
    const result = await fn();
    await setStatus(jobId, JobStatus.COMPLETED, null);
    await prisma.job.update({
      where: { id: jobId },
      data: { payload: { ...payload, attempts, nextRunAt: null } },
    });
    return { ok: true, result };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const retry = await recordFailureForRetry(jobId, msg);
    return { ok: false, error: msg, retry };
  }
}
