import type { PlanId } from "@/lib/billing/plans";

export type PlanLimits = {
  researchQueries: number;
  videoJobs: number;
  imageJobs: number;
};

const LIMITS: Record<PlanId, PlanLimits> = {
  FREE: { researchQueries: 0, videoJobs: 0, imageJobs: 0 },
  GROWTH: { researchQueries: 10, videoJobs: 25, imageJobs: 100 },
  SCALE: { researchQueries: 30, videoJobs: 120, imageJobs: 500 },
};

export function getPlanLimits(planId: PlanId): PlanLimits {
  return LIMITS[planId] ?? LIMITS.FREE;
}
