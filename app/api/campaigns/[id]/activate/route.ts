import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: campaignId } = await params;

  if (!campaignId) {
    return NextResponse.json(
      { error: "Campaign ID required" },
      { status: 400 }
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      state: true,
      accountId: true,
      account: {
        select: {
          users: {
            where: { id: userId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!campaign || campaign.account.users.length === 0) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  try {
    await assertEntitled(campaign.accountId, "campaign.activate");
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json({ error: reason }, { status: 403 });
  }

  if (campaign.state !== "DRAFT") {
    return NextResponse.json(
      { error: "Only DRAFT campaigns can be activated" },
      { status: 409 }
    );
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { state: "ACTIVE" },
  });

  return NextResponse.json(updated, { status: 200 });
}
