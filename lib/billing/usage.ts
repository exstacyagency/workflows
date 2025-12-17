import { prisma } from "../prisma";
import type { PlanId } from "./plans";
import { getPlanLimits, type PlanLimits } from "./quotas";

export type UsageMetric = keyof PlanLimits;

type UsageColumn = "jobsUsed" | "videoJobsUsed" | "tokensUsed";

const USAGE_COLUMN_BY_METRIC: Record<UsageMetric, UsageColumn> = {
  researchQueries: "jobsUsed",
  videoJobs: "videoJobsUsed",
  imageJobs: "tokensUsed",
};

function to2(n: number) {
  return String(n).padStart(2, "0");
}

export function getCurrentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${to2(now.getUTCMonth() + 1)}`;
}

export function periodKeyToUtcDate(periodKey: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new Error(`Invalid periodKey: ${periodKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid periodKey: ${periodKey}`);
  }
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export async function getOrCreateUsage(userId: string, periodKey: string) {
  const period = periodKeyToUtcDate(periodKey);

  const existing = await prisma.usage.findUnique({
    where: { userId_period: { userId, period } },
  });
  if (existing) return existing;

  try {
    return await prisma.usage.create({ data: { userId, period } });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const after = await prisma.usage.findUnique({
        where: { userId_period: { userId, period } },
      });
      if (after) return after;
    }
    throw err;
  }
}

export async function incrementUsage(
  userId: string,
  periodKey: string,
  metric: UsageMetric,
  amount = 1
) {
  const period = periodKeyToUtcDate(periodKey);
  const column = USAGE_COLUMN_BY_METRIC[metric];

  return prisma.usage.upsert({
    where: { userId_period: { userId, period } },
    create: { userId, period, [column]: amount },
    update: { [column]: { increment: amount } },
  });
}

export type QuotaReservation = {
  periodKey: string;
  metric: UsageMetric;
  amount: number;
};

export class QuotaExceededError extends Error {
  metric: UsageMetric;
  used: number;
  limit: number;

  constructor(params: { metric: UsageMetric; used: number; limit: number }) {
    super(`Quota exceeded: ${params.metric} (${params.used}/${params.limit})`);
    this.name = "QuotaExceededError";
    this.metric = params.metric;
    this.used = params.used;
    this.limit = params.limit;
  }
}

export async function reserveQuota(
  userId: string,
  planId: PlanId,
  metric: UsageMetric,
  amount = 1
): Promise<QuotaReservation> {
  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);

  const limits = getPlanLimits(planId);
  const limit = limits[metric] ?? 0;
  const column = USAGE_COLUMN_BY_METRIC[metric];

  await getOrCreateUsage(userId, periodKey);

  const maxAllowed = limit - amount;
  if (maxAllowed < 0) {
    const usage = await prisma.usage.findUnique({
      where: { userId_period: { userId, period } },
    });
    const used = Number((usage as any)?.[column] ?? 0);
    throw new QuotaExceededError({ metric, used, limit });
  }

  const updated = await prisma.usage.updateMany({
    where: {
      userId,
      period,
      [column]: { lte: maxAllowed },
    } as any,
    data: {
      [column]: { increment: amount },
    } as any,
  });

  if (updated.count === 0) {
    const usage = await prisma.usage.findUnique({
      where: { userId_period: { userId, period } },
    });
    const used = Number((usage as any)?.[column] ?? 0);
    throw new QuotaExceededError({ metric, used, limit });
  }

  return { periodKey, metric, amount };
}

export async function rollbackQuota(
  userId: string,
  periodKey: string,
  metric: UsageMetric,
  amount = 1
) {
  const period = periodKeyToUtcDate(periodKey);
  const column = USAGE_COLUMN_BY_METRIC[metric];

  const dec = await prisma.usage.updateMany({
    where: {
      userId,
      period,
      [column]: { gte: amount },
    } as any,
    data: {
      [column]: { decrement: amount },
    } as any,
  });

  if (dec.count > 0) return;

  await prisma.usage.updateMany({
    where: { userId, period },
    data: { [column]: 0 } as any,
  });
}

export async function assertQuota(
  userId: string,
  planId: PlanId,
  metric: UsageMetric,
  amount = 1
) {
  const limits = getPlanLimits(planId);
  const limit = limits[metric] ?? 0;
  const periodKey = getCurrentPeriodKey();
  const usage = await getOrCreateUsage(userId, periodKey);

  const column = USAGE_COLUMN_BY_METRIC[metric];
  const used = Number((usage as any)?.[column] ?? 0);

  if (used + amount > limit) {
    throw new QuotaExceededError({ metric, used, limit });
  }

  return { periodKey, used, limit };
}
