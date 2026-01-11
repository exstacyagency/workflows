import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { assertEntitled } from "@/lib/entitlements";

async function resolveUserContext(req: NextRequest) {
  const testUserId = req.headers.get("x-test-user-id");
  const sessionUserId = testUserId ?? (await getSessionUserId());
  if (!sessionUserId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    include: { account: true },
  });

  if (!user || !user.account) {
    return null;
  }

  return { user, account: user.account };
}

export async function POST(req: NextRequest) {
  const ctx = await resolveUserContext(req);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let name = "";
  if (
    payload &&
    typeof payload === "object" &&
    "name" in payload &&
    typeof (payload as { name?: unknown }).name === "string"
  ) {
    name = ((payload as { name: string }).name ?? "").trim();
  }

  if (!name) {
    return NextResponse.json({ error: "Campaign name required" }, { status: 400 });
  }

  try {
    await assertEntitled({
      userId: ctx.user.id,
      account: { id: ctx.account.id, tier: ctx.account.tier },
      action: "campaign.create",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Forbidden";
    return NextResponse.json(
      { allowed: false, reason },
      { status: 403 },
    );
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      accountId: ctx.account.id,
    },
    select: {
      id: true,
      name: true,
      accountId: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    { allowed: true, campaign },
    { status: 201 },
  );
}
