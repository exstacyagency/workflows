import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/getSessionUser";
import { getCurrentPeriodKey, periodKeyToUtcDate } from "@/lib/billing/usage";

function devAdminDisabled() {
  return (
    cfg.raw("NODE_ENV") === "production" ||
    cfg.raw("DISABLE_DEV_ADMIN") === "true"
  );
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function POST(req: NextRequest) {
  if (devAdminDisabled()) return new NextResponse(null, { status: 404 });

  let sessionUser: any = null;
  try {
    sessionUser = await getSessionUser();
  } catch (err) {
    console.error("make-growth auth failed", err);
  }

  const userId = (sessionUser as any)?.id as string | undefined;
  const email = (sessionUser as any)?.email as string | undefined;
  const name = (sessionUser as any)?.name as string | undefined;
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const normalizedUserId = userId.trim();
  const normalizedEmail =
    email && typeof email === "string" && email.trim().length > 0
      ? email.trim()
      : `${normalizedUserId}@local.dev`;

  let projectId = "proj_test";
  let resetUsage = true;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object") {
      const bodyProjectId = (body as any).projectId;
      if (bodyProjectId !== undefined) {
        if (
          typeof bodyProjectId !== "string" ||
          bodyProjectId.trim().length === 0
        ) {
          return NextResponse.json(
            { error: "Invalid projectId" },
            { status: 400 }
          );
        }
        projectId = bodyProjectId.trim();
      }
      const bodyResetUsage = (body as any).resetUsage;
      if (bodyResetUsage !== undefined) {
        if (typeof bodyResetUsage !== "boolean") {
          return NextResponse.json(
            { error: "Invalid resetUsage" },
            { status: 400 }
          );
        }
        resetUsage = bodyResetUsage;
      }
    }
  } catch {
    // Body is optional.
  }

  try {
    await prisma.user.upsert({
      where: { id: normalizedUserId },
      update: { updatedAt: new Date() },
      create: {
        id: normalizedUserId,
        email: normalizedEmail,
        name: name && typeof name === "string" ? name : undefined,
      },
    });

    const lockoutResult = await prisma.authThrottle.deleteMany({
      where: {
        OR: [
          { identifier: { equals: normalizedEmail, mode: "insensitive" } },
          { identifier: { contains: normalizedEmail, mode: "insensitive" } },
        ],
      },
    });

    const now = new Date();
    const currentPeriodEnd = addDays(now, 30);
    const placeholders = {
      stripeCustomerId: `dev_cus_${normalizedUserId}`,
      stripeSubscriptionId: `dev_sub_${normalizedUserId}`,
      stripePriceId: "dev_price_growth",
    };

    const existingSub = await prisma.subscription.findUnique({
      where: { userId: normalizedUserId },
      select: {
        id: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
      },
    });

    const stripeUpdate: {
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      stripePriceId?: string;
    } = {};
    if (!existingSub?.stripeCustomerId) {
      stripeUpdate.stripeCustomerId = placeholders.stripeCustomerId;
    }
    if (!existingSub?.stripeSubscriptionId) {
      stripeUpdate.stripeSubscriptionId = placeholders.stripeSubscriptionId;
    }
    if (!existingSub?.stripePriceId) {
      stripeUpdate.stripePriceId = placeholders.stripePriceId;
    }

    const subscription = existingSub
      ? await prisma.subscription.update({
          where: { userId: normalizedUserId },
          data: {
            planId: "GROWTH",
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd,
            ...stripeUpdate,
          },
          select: { planId: true, status: true },
        })
      : await prisma.subscription.create({
          data: {
            userId: normalizedUserId,
            planId: "GROWTH",
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd,
            ...placeholders,
          },
          select: { planId: true, status: true },
        });

    await prisma.project.upsert({
      where: { id: projectId },
      update: { userId: normalizedUserId, name: "Test Project" },
      create: {
        id: projectId,
        userId: normalizedUserId,
        name: "Test Project",
      },
    });

    let periodKey: string | undefined = undefined;
    if (resetUsage) {
      periodKey = getCurrentPeriodKey();
      const period = periodKeyToUtcDate(periodKey);
      await prisma.usage.upsert({
        where: { userId_period: { userId: normalizedUserId, period } },
        update: { jobsUsed: 0, videoJobsUsed: 0, tokensUsed: 0 },
        create: {
          userId: normalizedUserId,
          period,
          jobsUsed: 0,
          videoJobsUsed: 0,
          tokensUsed: 0,
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        userId: normalizedUserId,
        email: normalizedEmail,
        projectId,
        subscription: { planId: subscription.planId, status: subscription.status },
        periodKey,
        clearedLockouts: lockoutResult.count,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("make-growth failed", err);
    const payload: { error: string; detail?: string } = {
      error: "Failed to make growth",
    };
    if (cfg.raw("NODE_ENV") !== "production") {
      payload.detail = String((err as any)?.message ?? err);
    }
    return NextResponse.json(payload, { status: 500 });
  }
}

