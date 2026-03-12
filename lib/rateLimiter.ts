import { cfg } from "@/lib/config";
import { prisma } from '@/lib/prisma';

const LIMITS = {
  jobsPerHour: 10,
  jobsPerDay: 50,
  concurrentJobs: 3,
  projectsPerHour: 5,
};

type RateLimitResult = { allowed: boolean; reason?: string };
type RateLimitOptions = { limit?: number; windowMs?: number };
type RequestRateLimitOptions = {
  keyPrefix: string;
  limit?: number;
  windowSec?: number;
  key?: string;
};

async function withSerializableRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code ?? "");
      const message = String(error?.message ?? "");
      const isSerializationConflict =
        code === "P2034" ||
        message.includes("could not serialize access") ||
        message.includes("deadlock detected");
      if (!isSerializationConflict || attempt === retries) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function internalCheckRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const windowMs = Math.max(1000, opts.windowMs);
  const limit = Math.max(1, opts.limit);
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  return withSerializableRetry(async () =>
    prisma.$transaction(
      async (tx) => {
        const existing = await (tx as any).rateLimitBucket.findUnique({
          where: { key },
          select: { id: true, windowStart: true, count: true },
        });

        if (!existing || existing.windowStart.getTime() !== windowStartMs) {
          await (tx as any).rateLimitBucket.upsert({
            where: { key },
            create: { key, windowStart, count: 1 },
            update: { windowStart, count: 1 },
          });
          return { allowed: true };
        }

        if (existing.count >= limit) {
          return {
            allowed: false,
            reason: `Rate limit exceeded (${limit}/${Math.floor(windowMs / 1000)}s)`,
          };
        }

        await (tx as any).rateLimitBucket.update({
          where: { id: existing.id },
          data: { count: { increment: 1 } },
        });

        return { allowed: true };
      },
      { isolationLevel: 'Serializable' }
    )
  );
}

export async function checkRateLimit(
  identifier: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const force = cfg.raw("FORCE_RATE_LIMIT") === '1';
  const isProd = cfg.raw("NODE_ENV") === 'production';
  if (!isProd && !force) {
    return { allowed: true };
  }

  try {
    const hasCustomOpts = opts.limit !== undefined || opts.windowMs !== undefined;
    if (hasCustomOpts) {
      return internalCheckRateLimit(identifier, {
        limit: opts.limit ?? 60,
        windowMs: opts.windowMs ?? 60 * 1000,
      });
    }

    if (identifier.startsWith('project:create:')) {
      return internalCheckRateLimit(identifier, {
        limit: LIMITS.projectsPerHour,
        windowMs: 60 * 60 * 1000,
      });
    }

    if (!identifier.includes(':')) {
      const runningCount = await prisma.job.count({
        where: {
          projectId: identifier,
          status: { in: ['PENDING', 'RUNNING'] },
        },
      });

      if (runningCount >= LIMITS.concurrentJobs) {
        return {
          allowed: false,
          reason: `${runningCount} jobs already running (max: ${LIMITS.concurrentJobs})`,
        };
      }

      const hourly = await internalCheckRateLimit(`${identifier}:hour`, {
        limit: LIMITS.jobsPerHour,
        windowMs: 60 * 60 * 1000,
      });
      if (!hourly.allowed) return hourly;

      const daily = await internalCheckRateLimit(`${identifier}:day`, {
        limit: LIMITS.jobsPerDay,
        windowMs: 24 * 60 * 60 * 1000,
      });
      if (!daily.allowed) return daily;

      return { allowed: true };
    }

    return internalCheckRateLimit(identifier, {
      limit: LIMITS.jobsPerHour,
      windowMs: 60 * 60 * 1000,
    });
  } catch (err: any) {
    const msg = `Rate limiter unavailable: ${String(err?.message ?? err)}`;
    if (isProd || force) {
      return { allowed: false, reason: msg };
    }
    return { allowed: true, reason: msg };
  }
}

export async function rateLimit(
  req: Request,
  opts: RequestRateLimitOptions,
): Promise<RateLimitResult> {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const realIp = req.headers.get('x-real-ip') ?? '';
  // TODO(low): treat "unknown" as a coarse shared bucket only until trusted proxy headers are guaranteed everywhere.
  const ip = (forwarded || realIp).split(',')[0]?.trim() || 'unknown';
  const key = opts.key ?? ip;
  const windowMs = (opts.windowSec ?? 60) * 1000;
  const limit = opts.limit ?? 60;

  return checkRateLimit(`${opts.keyPrefix}:${key}`, { limit, windowMs });
}
