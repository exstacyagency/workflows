import { prisma } from "./prisma";
import { cfg } from "./config";

export type EntitlementAction =
  | "campaign.create"
  | "campaign.activate"
  | "job.enqueue"
  | "analytics.read";

export type EntitlementResult = {
  allowed: boolean;
  reason?: string;
  limits?: Record<string, number>;
};

type EntitlementInput = {
  user: { id: string };
  account: { id: string; tier: string; spendCap: number };
  action: EntitlementAction;
};

export async function checkEntitlement(
  input: EntitlementInput,
): Promise<EntitlementResult> {
  const { account, action } = input;

  // 🔒 Global panic switch
  if (cfg.raw("PANIC_DISABLE_ALL") === "true") {
    return {
      allowed: false,
      reason: "SYSTEM_DISABLED",
    };
  }

  // ===== FREE TIER =====
  if (account.tier === "FREE") {
    if (action === "campaign.create") {
      const count = await prisma.campaign.count({
        where: { accountId: account.id },
      });

      if (count >= 1) {
        return {
          allowed: false,
          reason: "FREE_CAMPAIGN_LIMIT_REACHED",
          limits: { maxCampaigns: 1 },
        };
      }
    }

    if (action === "job.enqueue") {
      return {
        allowed: false,
        reason: "FREE_JOBS_DISABLED",
      };
    }

    if (action === "analytics.read") {
      return {
        allowed: false,
        reason: "UPGRADE_REQUIRED",
      };
    }
  }

  // ===== PAID TIERS =====
  if (action === "campaign.activate") {
    const activeCount = await prisma.campaign.count({
      where: {
        accountId: account.id,
      },
    });

    if (activeCount >= 5) {
      return {
        allowed: false,
        reason: "ACTIVE_CAMPAIGN_LIMIT",
        limits: { maxActiveCampaigns: 5 },
      };
    }
  }

  return { allowed: true };
}