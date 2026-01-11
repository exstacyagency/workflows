import { prisma } from "@/lib/prisma";

export type EntitlementAction =
  | "CAMPAIGN_CREATE"
  | "JOB_ENQUEUE"
  | "ANALYTICS_READ"
  | "SPEND_APPLY";

export type EntitlementCheck = {
  userId: string;
  accountId: string;
  action: EntitlementAction;
};

export type EntitlementResponse = {
  allowed: boolean;
  reason?: string;
  limits?: Record<string, number>;
};

export async function checkEntitlement(
  params: EntitlementCheck
): Promise<EntitlementResponse> {
  if (process.env.DISABLE_ALL_MUTATIONS === "true") {
    return { allowed: false, reason: "SYSTEM_DISABLED" };
  }

  const account = await prisma.account.findUnique({
    where: { id: params.accountId },
    select: { tier: true },
  });

  if (!account) {
    return { allowed: false, reason: "ACCOUNT_NOT_FOUND" };
  }

  if (account.tier === "FREE") {
    switch (params.action) {
      case "CAMPAIGN_CREATE":
        return { allowed: false, reason: "FREE_TIER_CAMPAIGN_LIMIT" };
      case "JOB_ENQUEUE":
        return { allowed: false, reason: "FREE_TIER_JOB_DENIED" };
      case "ANALYTICS_READ":
        return { allowed: false, reason: "FREE_TIER_ANALYTICS_DENIED" };
      default:
        break;
    }
  }

  return { allowed: true };
}