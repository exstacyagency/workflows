import { prisma } from '@/lib/prisma';

const LIMITS = {
  jobsPerHour: 10,
  jobsPerDay: 50,
  concurrentJobs: 3,
  projectsPerHour: 5,
};

type RateLimitResult = { allowed: boolean; reason?: string };
type RateLimitOptions = { limit?: number; windowMs?: number };

const inMemoryBuckets = new Map<string, { resetAt: number; count: number }>();

function checkInMemoryRateLimit(identifier: string, opts: RateLimitOptions = {}): RateLimitResult {
  const windowMs = opts.windowMs ?? 60 * 1000;
  const limit = opts.limit ?? 60;
  const now = Date.now();

  const bucket = inMemoryBuckets.get(identifier);
  if (!bucket || now > bucket.resetAt) {
    inMemoryBuckets.set(identifier, { resetAt: now + windowMs, count: 1 });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    const seconds = Math.max(1, Math.round(windowMs / 1000));
    return { allowed: false, reason: `Rate limit exceeded (max ${limit} per ${seconds}s)` };
  }

  bucket.count += 1;
  return { allowed: true };
}

export async function checkRateLimit(
  identifier: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (identifier.startsWith('deadletter:')) {
    return checkInMemoryRateLimit(identifier, opts);
  }
  const now = new Date();

  if (identifier.startsWith('project:create:')) {
    const [, , userId] = identifier.split(':');
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const created = await prisma.project.count({
      where: {
        userId,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (created >= LIMITS.projectsPerHour) {
      return {
        allowed: false,
        reason: `${created} projects created in last hour (max: ${LIMITS.projectsPerHour})`,
      };
    }

    return { allowed: true };
  }

  const projectId = identifier;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [hourlyCount, dailyCount, runningCount] = await Promise.all([
    prisma.job.count({
      where: {
        projectId,
        createdAt: { gte: oneHourAgo },
      },
    }),
    prisma.job.count({
      where: {
        projectId,
        createdAt: { gte: oneDayAgo },
      },
    }),
    prisma.job.count({
      where: {
        projectId,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    }),
  ]);

  if (runningCount >= LIMITS.concurrentJobs) {
    return { allowed: false, reason: `${runningCount} jobs already running (max: ${LIMITS.concurrentJobs})` };
  }

  if (hourlyCount >= LIMITS.jobsPerHour) {
    return { allowed: false, reason: `${hourlyCount} jobs in last hour (max: ${LIMITS.jobsPerHour})` };
  }

  if (dailyCount >= LIMITS.jobsPerDay) {
    return { allowed: false, reason: `${dailyCount} jobs in last 24h (max: ${LIMITS.jobsPerDay})` };
  }

  return { allowed: true };
}
