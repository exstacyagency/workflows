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
    return NextResponse.json(
      { error: "accountId and name required" },
      { status: 400 }
    );
  }

  /** -------------------------------------------------
   * Load account explicitly (authoritative source)
   * ------------------------------------------------- */
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, tier: true },
  });

  if (!account) {
    return NextResponse.json(
      { error: "Account not found" },
      { status: 404 }
    );
  }

  /** -------------------------------------------------
   * HARD BLOCK: FREE tier cannot create campaigns
   * ------------------------------------------------- */
  if (account.tier === "FREE") {
    return NextResponse.json(
      { error: "Campaign creation not allowed on FREE tier" },
      { status: 403 }
    );
  }

  /** -------------------------------------------------
   * Secondary entitlement gate (future-proofing)
   * ------------------------------------------------- */
  try {
    await assertEntitled(account.id, "campaign.create");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json({ error: reason }, { status: 403 });
  }

  /** -------------------------------------------------
   * Create campaign
   * ------------------------------------------------- */
  const campaign = await prisma.campaign.create({
    data: {
      accountId: account.id,
      name,
    },
  });

  return NextResponse.json(campaign, { status: 201 });
}