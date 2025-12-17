import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/getSessionUser";
import { getCurrentPeriodKey, periodKeyToUtcDate } from "@/lib/billing/usage";

function devAdminDisabled() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.DISABLE_DEV_ADMIN === "true"
  );
}

export async function POST(req: NextRequest) {
  if (devAdminDisabled()) return new NextResponse(null, { status: 404 });

  let sessionUser: any = null;
  try {
    sessionUser = await getSessionUser();
  } catch (err) {
    console.error("reset-usage auth failed", err);
  }
  const userId = (sessionUser as any)?.id as string | undefined;
  const sessionEmail = (sessionUser as any)?.email as string | undefined;
  const sessionName = (sessionUser as any)?.name as string | undefined;
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const normalizedUserId = userId.trim();

  void req;

  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);

  try {
    const baseEmail = sessionEmail ?? `${normalizedUserId}@local.dev`;
    try {
      await prisma.user.upsert({
        where: { id: normalizedUserId },
        update: { updatedAt: new Date() },
        create: {
          id: normalizedUserId,
          email: baseEmail,
          name: sessionName ?? "Dev User",
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        await prisma.user.upsert({
          where: { id: normalizedUserId },
          update: { updatedAt: new Date() },
          create: {
            id: normalizedUserId,
            email: `${normalizedUserId}.${Date.now()}@local.dev`,
            name: sessionName ?? "Dev User",
          },
        });
      } else {
        throw err;
      }
    }

    await prisma.usage.upsert({
      where: { userId_period: { userId: normalizedUserId, period } },
      create: {
        userId: normalizedUserId,
        period,
        jobsUsed: 0,
        videoJobsUsed: 0,
        tokensUsed: 0,
      },
      update: {
        jobsUsed: 0,
        videoJobsUsed: 0,
        tokensUsed: 0,
      },
    });
  } catch (err) {
    console.error("reset-usage failed", err);
    const payload: { error: string; detail: string } = {
      error: "Failed to reset usage",
      detail: String((err as any)?.message ?? err),
    };
    return NextResponse.json(payload, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, userId: normalizedUserId, periodKey },
    { status: 200 }
  );
}
