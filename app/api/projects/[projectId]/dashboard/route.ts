import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { getCurrentPeriodKey, getOrCreateUsage } from "@/lib/billing/usage";

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

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const subscriptionRow = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      planId: true,
      status: true,
    },
  });

  const subscription = {
    planId: (subscriptionRow?.planId as "FREE" | "GROWTH" | "SCALE" | null) ?? null,
    status: subscriptionRow?.status ?? null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
  };

  const periodKey = getCurrentPeriodKey();
  const usageRow = await getOrCreateUsage(userId, periodKey);

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
      project,
      subscription,
      usage: { periodKey, row: usageRow },
      recentJobs,
    },
    { status: 200 }
  );
}
