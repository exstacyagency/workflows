import { prisma } from "@/lib/prisma";
import { cfg } from "@/lib/config";

export type EntitlementAction =
  | "campaign.create"
  | "campaign.activate"
  | "spend.charge"
  | `job.${string}`;

type EntitlementContext = {
  amount?: number;
};

export async function assertEntitled(
  accountId: string,
  action: EntitlementAction,
  context?: EntitlementContext,
): Promise<void> {
  if (cfg().raw("PANIC_DISABLE_ALL") === "true") {
    throw new Error("SYSTEM_DISABLED");
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error("Account not found");
  }

  if (account.tier === "FREE" && action === "campaign.create") {
    const count = await prisma.campaign.count({ where: { accountId } });
    if (count >= 1) {
      await prisma.auditLog.create({
        data: {
          action: "entitlement.denied",
          metadata: { tier: account.tier, action },
        },
      });
      throw new Error("FREE tier limited to 1 campaign");
    }
  }

  if (action === "spend.charge") {
    const amount = context?.amount ?? 0;
    if (account.spend + amount > account.spendCap) {
      await prisma.auditLog.create({
        data: {
          action: "entitlement.denied",
          metadata: { tier: account.tier, action, amount },
        },
      });
      throw new Error("Spend cap exceeded");
    }
  }
}