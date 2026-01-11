import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";

type CampaignPayload = {
  accountId?: unknown;
  name?: unknown;
};

export async function POST(req: Request) {
  let body: CampaignPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!accountId || !name) {
    return NextResponse.json({ error: "accountId and name required" }, { status: 400 });
  }

  try {
    await assertEntitled(accountId, "campaign.create");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json({ error: reason }, { status: 403 });
  }

  const campaign = await prisma.campaign.create({
    data: { accountId, name },
  });

  return NextResponse.json(campaign, { status: 201 });
}
