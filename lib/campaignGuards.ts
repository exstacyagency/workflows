import { prisma } from "@/lib/prisma";

export async function assertCampaignActive(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      state: true,
      accountId: true,
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (campaign.state !== "ACTIVE") {
    throw new Error("Campaign is not active");
  }

  return campaign;
}
