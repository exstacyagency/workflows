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

async function internalCheckRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const windowMs = Math.max(1000, opts.windowMs);
  const limit = Math.max(1, opts.limit);
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);

  const existing = await prisma.rateLimitBucket.findUnique({
    where: { key },
    select: { windowStart: true },
  });

  if (!existing || existing.windowStart.getTime() !== windowStartMs) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, windowStart, count: 1 },
      update: { windowStart, count: 1 },
    });
    return { allowed: true };
  }

  const updated = await prisma.rateLimitBucket.update({
    where: { key },
    data: { count: { increment: 1 } },
    select: { count: true },
  });

  if (updated.count > limit) {
    return {
      allowed: false,
      reason: `Rate limit exceeded (${limit}/${Math.floor(windowMs / 1000)}s)`,
    };
  }

  return { allowed: true };
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
  const ip = (forwarded || realIp).split(',')[0]?.trim() || 'unknown';
  const key = opts.key ?? ip;
  const windowMs = (opts.windowSec ?? 60) * 1000;
  const limit = opts.limit ?? 60;

  return checkRateLimit(`${opts.keyPrefix}:${key}`, { limit, windowMs });
}
