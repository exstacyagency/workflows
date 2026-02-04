// lib/billing/usage.ts
import { prisma } from "@/lib/prisma";

export type QuotaReservation = {
  periodKey: string;
  metric: string;
  amount: number;
};

export class QuotaExceededError extends Error {
  metric: string;
  limit: number;
  used: number;

  constructor(metric: string, limit: number, used: number) {
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

// Stub functions - always succeed
export async function reserveQuota(
  userId: string,
  planId: string,
  metric: string,
  amount: number
) {
  return {
    periodKey: getCurrentPeriodKey(),
    metric,
    amount,
  } satisfies QuotaReservation;
}

export async function rollbackQuota(
  userId: string,
  periodKey: string,
  metric: string,
  amount: number
) {
  return null;
}
