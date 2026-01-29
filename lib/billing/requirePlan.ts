// lib/billing/requirePlan.ts
export type PlanId = 'FREE' | 'GROWTH' | 'SCALE';

export class UpgradeRequiredError extends Error {
  requiredPlan: PlanId;
  constructor(requiredPlan: PlanId) {
    super(`Upgrade required: ${requiredPlan}`);
    this.name = "UpgradeRequiredError";
    this.requiredPlan = requiredPlan;
  }
}

// Always return FREE plan (no checks)
export async function assertMinPlan(userId: string, minPlan: PlanId): Promise<PlanId> {
  return 'FREE';
}