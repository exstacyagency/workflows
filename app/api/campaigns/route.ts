import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertEntitled } from "@/lib/entitlements";
import { getSessionUserId } from "@/lib/getSessionUserId";

type CampaignPayload = {
  accountId?: unknown;
  name?: unknown;
};

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    select: {
      id: true,
      tier: true,
      users: {
        where: { id: userId },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!account || account.users.length === 0) {
    return NextResponse.json(
      { error: "Account not found" },
      { status: 404 }
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
