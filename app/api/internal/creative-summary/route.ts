import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertInternalSecret } from "@/lib/internal/assertInternalSecret";
import { JobStatus, JobType } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const creativeJobTypes = [
    JobType.SCRIPT_GENERATION,
    JobType.STORYBOARD_GENERATION,
    JobType.VIDEO_PROMPT_GENERATION,
    JobType.VIDEO_IMAGE_GENERATION,
    JobType.VIDEO_GENERATION,
    JobType.VIDEO_UPSCALER,
    JobType.AD_QUALITY_GATE,
  ];

  const [completed, failed, qualityGateFailures] = await Promise.all([
    prisma.job.groupBy({
      by: ["type"],
      where: {
        type: { in: creativeJobTypes },
        status: JobStatus.COMPLETED,
        updatedAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
    }),
    prisma.job.groupBy({
      by: ["type"],
      where: {
        type: { in: creativeJobTypes },
        status: JobStatus.FAILED,
        updatedAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
    }),
    prisma.job.findMany({
      where: {
        type: JobType.AD_QUALITY_GATE,
        status: JobStatus.FAILED,
        updatedAt: { gte: sevenDaysAgo },
      },
      select: { id: true, projectId: true, error: true, updatedAt: true },
    }),
  ]);

  return NextResponse.json({ completed, failed, qualityGateFailures });
}
