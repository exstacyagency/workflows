import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/user/billing/summary
 *
 * Returns the authenticated user's subscription plan, current-period spend
 * rolled up from usage_event rows, and a per-project breakdown.
 *
 * Used by: Spacebot billing agent (SKILL.md)
 * Auth: session cookie (same as all user-facing routes)
 */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Period: current calendar month
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { planId: true, status: true },
  });

  const usageEvents = await prisma.usage_event.findMany({
    where: {
      userId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    select: {
      projectId: true,
      provider: true,
      model: true,
      metric: true,
      units: true,
      costCents: true,
      createdAt: true,
    },
  });

  const totalCostCents = usageEvents.reduce((sum, e) => sum + e.costCents, 0);

  const byProject: Record<string, number> = {};
  for (const e of usageEvents) {
    byProject[e.projectId] = (byProject[e.projectId] ?? 0) + e.costCents;
  }

  const byProvider: Record<string, number> = {};
  for (const e of usageEvents) {
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + e.costCents;
  }

  const jobCounts = await prisma.job.groupBy({
    by: ["type", "status"],
    where: {
      userId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    _count: { id: true },
  });

  return NextResponse.json({
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    },
    subscription: {
      planId: subscription?.planId ?? null,
      status: subscription?.status ?? null,
    },
    spend: {
      totalCents: totalCostCents,
      totalDollars: (totalCostCents / 100).toFixed(2),
      byProject,
      byProvider,
    },
    jobs: jobCounts.map((r) => ({
      type: r.type,
      status: r.status,
      count: r._count.id,
    })),
  });
}
