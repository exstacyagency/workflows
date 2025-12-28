import { cfg } from "@/lib/config";
import { prisma } from "./prisma.ts";
import { JobStatus } from "@prisma/client";

const MAX_ATTEMPTS = Number(cfg.raw("MAX_JOB_ATTEMPTS") ?? 3);
const BASE_MS = Number(cfg.raw("JOB_RETRY_BASE_MS") ?? 1000);
const MAX_MS = Number(cfg.raw("JOB_RETRY_MAX_MS") ?? 60_000);

type Payload = Record<string, any>;

function isConfigError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("must be set in .env") ||
    m.includes("redis_url missing") ||
    m.includes("redis not configured") ||
    m.includes("apify_api_token") ||
    m.includes("kie_api_key")
  );
}

function isPermanentError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("missing dependencies") ||
    isConfigError(m) ||
    m.includes("must be set in .env") ||
    m.includes("configerror") ||
    m.includes("redis_url missing") ||
    m.includes("redis not configured") ||
    m.includes("apify_api_token") ||
    m.includes("kie_api_key") ||
    (m.includes("missing") &&
      (m.includes("api key") ||
        m.includes("api_key") ||
        m.includes("apikey") ||
        m.includes("token") ||
        m.includes("secret") ||
        m.includes("auth"))) ||
    m.includes("must be set") ||
    m.includes("not set") ||
    m.includes("required") ||
    m.includes("invalid input") ||
    m.includes("forbidden") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("403")
  );
}

function isTransientError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("etimedout") ||
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("bad gateway") ||
    m.includes("service unavailable") ||
    m.includes("gateway timeout") ||
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("socket hang up") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("eai_again")
  );
}

export function canTransition(from: JobStatus, to: JobStatus) {
  const allowed: Record<JobStatus, JobStatus[]> = {
    PENDING: [JobStatus.RUNNING, JobStatus.FAILED],
    RUNNING: [JobStatus.COMPLETED, JobStatus.FAILED],
    COMPLETED: [],
    FAILED: [JobStatus.PENDING],
  };
  return (allowed[from] ?? []).includes(to);
}

export function computeBackoffMs(attempt: number) {
  const exp = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

export async function setStatus(jobId: string, next: JobStatus, error?: string | null) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  if (!canTransition(job.status, next)) return job;

  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: next,
      error: error ?? (next === JobStatus.FAILED ? "Job failed" : null),
    },
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
  const { payload } = await getRetryState(jobId);
  const attempts = Number(payload.attempts ?? 0);

  const permanent = isPermanentError(errMsg) || !isTransientError(errMsg);
  if (permanent) {
    const nextPayload = {
      ...payload,
      lastError: errMsg,
      nextRunAt: null,
      attempts: isConfigError(errMsg) ? 0 : attempts,
    };
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.FAILED, error: errMsg, payload: nextPayload },
    });
    return { willRetry: false, attempts: nextPayload.attempts, backoffMs: null };
  }

  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: `Max attempts exceeded: ${errMsg}`,
        payload: {
          ...payload,
          attempts: nextAttempts,
          lastError: errMsg,
          nextRunAt: null,
        },
      },
    });
    return { willRetry: false, attempts: nextAttempts, backoffMs: null };
  }

  const backoffMs = computeBackoffMs(nextAttempts);
  const nextRunAt = Date.now() + backoffMs;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PENDING,
      error: errMsg,
      payload: {
        ...payload,
        attempts: nextAttempts,
        lastError: errMsg,
        nextRunAt,
      },
    },
  });

  return { willRetry: true, attempts: nextAttempts, backoffMs };
}

export async function runWithState(jobId: string, fn: () => Promise<any>) {
  const { job, payload, attempts, nextRunAt } = await getRetryState(jobId);

  if (job.status === JobStatus.COMPLETED) {
    return { ok: true, result: null, skipped: "already_completed" as const };
  }

  if (nextRunAt && Date.now() < nextRunAt) {
    return { ok: false, result: null, skipped: "backoff_active" as const, nextRunAt };
  }

  if (job.status === JobStatus.PENDING || job.status === JobStatus.FAILED) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, error: null },
    });
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
