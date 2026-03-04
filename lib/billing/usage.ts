import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/billing/quotas";
import type { PlanId } from "@/lib/billing/plans";

export type QuotaMetric = "researchQueries" | "videoJobs" | "imageJobs";

type IncomingMetric =
  | QuotaMetric
  | "patternAnalysisJobs"
  | "adCollectionJobs"
  | (string & {});

export type QuotaReservation = {
  reservationId: string;
  periodKey: string;
  metric: QuotaMetric;
  amount: number;
};

export class QuotaExceededError extends Error {
  metric: QuotaMetric;
  limit: number;
  used: number;

  constructor(metric: QuotaMetric, limit: number, used: number) {
    super(`Quota exceeded for ${metric}: ${used}/${limit}`);
    this.name = "QuotaExceededError";
    this.metric = metric;
    this.limit = limit;
    this.used = used;
  }
}

function to2(n: number) {
  return String(n).padStart(2, "0");
}

function periodKeyToUtcDate(periodKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) {
    throw new Error(`Invalid periodKey: ${periodKey}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid periodKey: ${periodKey}`);
  }
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function normalizeMetric(metric: IncomingMetric): QuotaMetric {
  const normalized = String(metric ?? "").trim();
  if (normalized === "videoJobs") return "videoJobs";
  if (normalized === "imageJobs") return "imageJobs";
  if (normalized === "researchQueries") return "researchQueries";

  // Legacy/non-canonical metrics roll into research quota.
  if (normalized === "patternAnalysisJobs") return "researchQueries";
  if (normalized === "adCollectionJobs") return "researchQueries";

  return "researchQueries";
}

function usageFieldForMetric(metric: QuotaMetric): "researchQueries" | "videoJobs" | "imageJobs" {
  return metric;
}

export function getCurrentPeriodKey(now: Date = new Date()) {
  return `${now.getUTCFullYear()}-${to2(now.getUTCMonth() + 1)}`;
}

export async function getOrCreateUsage(userId: string, periodKey: string) {
  const period = periodKeyToUtcDate(periodKey);
  return prisma.usage.upsert({
    where: { userId_period: { userId, period } },
    update: {},
    create: { userId, period },
  });
}

export async function reserveQuota(
  userId: string,
  planId: PlanId,
  metric: IncomingMetric,
  amount: number
): Promise<QuotaReservation> {
  const normalizedMetric = normalizeMetric(metric);
  const usageField = usageFieldForMetric(normalizedMetric);
  const incrementBy = Math.max(0, Math.trunc(Number(amount) || 0));
  if (incrementBy <= 0) {
    throw new Error(`Invalid quota reservation amount: ${amount}`);
  }

  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);
  const limits = getPlanLimits(planId);
  const metricLimit = Number(limits[normalizedMetric] ?? 0);

  return prisma.$transaction(async (tx) => {
    const usage = await tx.usage.upsert({
      where: { userId_period: { userId, period } },
      update: {},
      create: { userId, period },
    });

    const used = Number((usage as any)[usageField] ?? 0);

    // If limit is <= 0, treat as uncapped to avoid blocking legacy plans while still tracking usage.
    if (metricLimit > 0 && used + incrementBy > metricLimit) {
      throw new QuotaExceededError(normalizedMetric, metricLimit, used + incrementBy);
    }

    await tx.usage.update({
      where: { id: usage.id },
      data: {
        jobsUsed: { increment: incrementBy },
        [usageField]: { increment: incrementBy },
      },
    });

    const reservation = await tx.quota_reservation.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        period,
        metric: normalizedMetric,
        amount: incrementBy,
      },
    });

    return {
      reservationId: reservation.id,
      periodKey,
      metric: normalizedMetric,
      amount: incrementBy,
    } satisfies QuotaReservation;
  });
}

export async function rollbackQuota(
  userId: string,
  periodKey: string,
  metric: IncomingMetric,
  amount: number,
  reservationId?: string | null
) {
  const normalizedMetric = normalizeMetric(metric);
  const usageField = usageFieldForMetric(normalizedMetric);
  const decrementBy = Math.max(0, Math.trunc(Number(amount) || 0));
  if (decrementBy <= 0) return null;

  const period = periodKeyToUtcDate(periodKey);

  return prisma.$transaction(async (tx) => {
    const reservation = reservationId
      ? await tx.quota_reservation.findFirst({
          where: {
            id: reservationId,
            userId,
            metric: normalizedMetric,
            period,
            releasedAt: null,
          },
          select: { id: true, amount: true },
        })
      : await tx.quota_reservation.findFirst({
          where: {
            userId,
            metric: normalizedMetric,
            period,
            amount: decrementBy,
            releasedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, amount: true },
        });

    if (!reservation) {
      return null;
    }

    const reservedAmount = Math.max(1, Math.trunc(Number(reservation.amount) || decrementBy));

    const usage = await tx.usage.findUnique({
      where: { userId_period: { userId, period } },
      select: { id: true, jobsUsed: true, researchQueries: true, videoJobs: true, imageJobs: true },
    });

    if (usage) {
      const metricCurrent = Number((usage as any)[usageField] ?? 0);
      const nextMetric = Math.max(0, metricCurrent - reservedAmount);
      const nextJobsUsed = Math.max(0, Number(usage.jobsUsed ?? 0) - reservedAmount);

      await tx.usage.update({
        where: { id: usage.id },
        data: {
          jobsUsed: nextJobsUsed,
          [usageField]: nextMetric,
        },
      });
    }

    await tx.quota_reservation.update({
      where: { id: reservation.id },
      data: { releasedAt: new Date() },
    });

    return {
      reservationId: reservation.id,
      metric: normalizedMetric,
      amount: reservedAmount,
      periodKey,
    };
  });
}
