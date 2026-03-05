import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertInternalSecret } from "@/lib/internal/assertInternalSecret";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [todaySpend, weekSpend] = await Promise.all([
    prisma.usage_event.aggregate({
      where: { createdAt: { gte: today } },
      _sum: { costCents: true },
    }),
    prisma.usage_event.aggregate({
      where: { createdAt: { gte: sevenDaysAgo, lt: today } },
      _sum: { costCents: true },
    }),
  ]);

  const todayTotal = todaySpend._sum.costCents ?? 0;
  const weekTotal = weekSpend._sum.costCents ?? 0;
  const dailyAvg = weekTotal / 7;
  const spikeRatio = dailyAvg > 0 ? todayTotal / dailyAvg : null;

  return NextResponse.json({ todayTotal, dailyAvg, spikeRatio });
}
