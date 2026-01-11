import { NextResponse } from "next/server";
import { isSelfHosted } from "@/lib/config/mode";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function GET() {
  if (isSelfHosted()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      planId: true,
      status: true,
    },
  });

  if (!subscription) {
    return NextResponse.json(
      {
        planId: "FREE",
        status: null,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      planId: subscription.planId as "FREE" | "GROWTH" | "SCALE",
      status: subscription.status ?? null,
    },
    { status: 200 }
  );
}