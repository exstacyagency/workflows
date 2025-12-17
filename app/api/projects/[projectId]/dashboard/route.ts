import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { getCurrentPeriodKey, periodKeyToUtcDate } from "@/lib/billing/usage";

type Params = {
  params: { projectId: string };
};

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params?.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const subscriptionRow = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      planId: true,
      status: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

  const subscription = subscriptionRow
    ? {
        planId: subscriptionRow.planId as "FREE" | "GROWTH" | "SCALE",
        status: subscriptionRow.status ?? null,
        currentPeriodEnd: subscriptionRow.currentPeriodEnd
          ? subscriptionRow.currentPeriodEnd.toISOString()
          : null,
        cancelAtPeriodEnd: subscriptionRow.cancelAtPeriodEnd ?? null,
      }
    : {
        planId: "FREE" as const,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: null,
      };

  const periodKey = getCurrentPeriodKey();
  const period = periodKeyToUtcDate(periodKey);
  const usageRow = await prisma.usage.findUnique({
    where: { userId_period: { userId, period } },
    select: { jobsUsed: true, videoJobsUsed: true, tokensUsed: true },
  });

  const usage = {
    periodKey,
    jobsUsed: usageRow?.jobsUsed ?? 0,
    videoJobsUsed: usageRow?.videoJobsUsed ?? 0,
    tokensUsed: usageRow?.tokensUsed ?? 0,
  };

  const recentJobs = await prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    {
      project: {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      subscription,
      usage,
      recentJobs: recentJobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
    },
    { status: 200 }
  );
}

