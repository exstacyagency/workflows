import { prisma } from "@/lib/prisma";
import { cfg } from "@/lib/config";
import { AccountTier } from "@prisma/client";

export type EntitlementAction = "campaign.create";

type AssertEntitledInput = {
  userId: string;
  account: { id: string; tier: AccountTier };
  action: EntitlementAction;
};

export async function assertEntitled(
  opts: AssertEntitledInput,
): Promise<void> {
  const { account, action } = opts;

  if (cfg.raw("PANIC_DISABLE_ALL") === "true") {
    throw new Error("SYSTEM_DISABLED");
  }

  switch (account.tier) {
    case AccountTier.FREE: {
      if (action === "campaign.create") {
        const count = await prisma.campaign.count({
          where: {
            accountId: account.id,
          },
        });

        if (count >= 1) {
          throw new Error("FREE tier accounts may only create one campaign");
        }
      }

      break;
    }

    default:
      break;
  }
}