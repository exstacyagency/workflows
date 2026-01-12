import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(
  _req: Request,
  { params }: RouteContext
) {
  const campaignId = params.id;

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
    },
  });

  if (!campaign) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  try {
    await assertEntitled(campaign.accountId, "campaign.activate");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 403 });
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

  return NextResponse.json(updated);
}
