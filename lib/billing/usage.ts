// lib/billing/usage.ts
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

// Stub functions - always succeed
export async function reserveQuota(
  userId: string,
  planId: string,
  metric: string,
  amount: number
) {
  return null;
}

export async function rollbackQuota(
  userId: string,
  periodKey: string,
  metric: string,
  amount: number
) {
  return null;
}