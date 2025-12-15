// lib/billing.ts
import { prisma } from "@/lib/prisma";
import { startOfMonth } from "date-fns";

export async function getUserSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "active",
    },
  });

  if (!sub) {
    const growthPlan = await prisma.plan.findFirst({
      where: { name: "Growth" },
    });

    if (!growthPlan) {
      throw new Error("Growth plan not found in database");
    }

    return {
      plan: growthPlan,
      subscription: null,
    };
  }

  const planName = sub.planId === "SCALE" ? "Scale" : "Growth";
  const plan = await prisma.plan.findFirst({
    where: { name: planName },
  });
  if (!plan) {
    throw new Error(`${planName} plan not found in database`);
  }

  return {
    plan,
    subscription: sub,
  };
}

export async function getUserUsage(userId: string) {
  const period = startOfMonth(new Date());

  let usage = await prisma.usage.findUnique({
    where: {
      userId_period: {
        userId,
        period,
      },
    },
  });

  if (!usage) {
    usage = await prisma.usage.create({
      data: {
        userId,
        period,
      },
    });
  }

  return usage;
}

export async function incrementUsage(
  userId: string,
  type: "job" | "video" | "tokens",
  amount = 1
) {
  const period = startOfMonth(new Date());

  const field =
    type === "job"
      ? "jobsUsed"
      : type === "video"
      ? "videoJobsUsed"
      : "tokensUsed";

  await prisma.usage.upsert({
    where: {
      userId_period: {
        userId,
        period,
      },
    },
    create: {
      userId,
      period,
      [field]: amount,
    },
    update: {
      [field]: {
        increment: amount,
      },
    },
  });
}

export async function enforcePlanLimits(userId: string) {
  const { plan } = await getUserSubscription(userId);
  const usage = await getUserUsage(userId);

  if (usage.jobsUsed >= plan.maxJobsPerDay) {
    return { allowed: false, reason: "Daily job limit reached" };
  }

  if (usage.videoJobsUsed >= plan.maxVideoJobsPerDay) {
    return { allowed: false, reason: "Daily video jobs limit reached" };
  }

  if (usage.tokensUsed >= plan.maxMonthlyUsage) {
    return { allowed: false, reason: "Monthly usage cap reached" };
  }

  return { allowed: true };
}
