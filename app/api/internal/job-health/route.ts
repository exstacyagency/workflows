import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertInternalSecret } from "@/lib/internal/assertInternalSecret";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [stuckJobs, recentFailures] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: "RUNNING",
        updatedAt: { lt: thirtyMinutesAgo },
      },
      select: { id: true, type: true, projectId: true, updatedAt: true },
    }),
    prisma.job.findMany({
      where: {
        status: "FAILED",
        updatedAt: { gt: oneHourAgo },
      },
      select: { id: true, type: true, projectId: true, error: true, updatedAt: true },
    }),
  ]);

  return NextResponse.json({ stuckJobs, recentFailures });
}
