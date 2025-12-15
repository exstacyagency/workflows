import { prisma } from "@/lib/prisma";
import type { PlanId } from "@/lib/billing/plans";

export class UpgradeRequiredError extends Error {
  requiredPlan: PlanId;

  constructor(requiredPlan: PlanId) {
    super(`Upgrade required: ${requiredPlan}`);
    this.name = "UpgradeRequiredError";
    this.requiredPlan = requiredPlan;
  }
}

export async function getUserSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

function rank(planId: PlanId) {
  if (planId === "SCALE") return 2;
  if (planId === "GROWTH") return 1;
  return 0;
}

function normalizePlanId(planId: unknown): PlanId {
  if (planId === "SCALE") return "SCALE";
  if (planId === "GROWTH") return "GROWTH";
  return "FREE";
}

export async function assertMinPlan(userId: string, minPlan: PlanId) {
  if (minPlan === "FREE") return;

  const sub = await getUserSubscription(userId);
  const status = String(sub?.status ?? "").toLowerCase();
  const statusOk = status === "active" || status === "trialing";
  const planId = normalizePlanId(sub?.planId);

  if (sub && statusOk && rank(planId) >= rank(minPlan)) return;

  throw new UpgradeRequiredError(minPlan);
}

