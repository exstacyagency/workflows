import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { getCurrentPeriodKey, periodKeyToUtcDate } from "@/lib/billing/usage";

function devAdminDisabled() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.DISABLE_DEV_ADMIN === "true"
  );
}

export async function POST(req: NextRequest) {
  if (devAdminDisabled()) return new NextResponse(null, { status: 404 });

  let sessionUserId: string | null = null;
  try {
    sessionUserId = await getSessionUserId();
  } catch (err) {
    console.error("reset-usage auth failed", err);
  }
  if (!sessionUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let targetUserId = sessionUserId;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object") {
      const userId = (body as any).userId;
      if (userId !== undefined) {
        if (typeof userId !== "string" || userId.trim().length === 0) {
          return NextResponse.json(
            { error: "Invalid userId" },
            { status: 400 }
          );
        }
        targetUserId = userId.trim();
      }
    }
  } catch {
    // Body is optional.
  }

  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);

  try {
    await prisma.usage.upsert({
      where: { userId_period: { userId: targetUserId, period } },
      create: {
        userId: targetUserId,
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
    const payload: { error: string; detail?: string } = {
      error: "Failed to reset usage",
    };
    if (process.env.NODE_ENV !== "production") {
      payload.detail = String((err as any)?.message ?? err);
    }
    return NextResponse.json(payload, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, userId: targetUserId, periodKey },
    { status: 200 }
  );
}
