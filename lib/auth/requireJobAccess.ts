import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

type JobAccess = {
  userId: string;
  jobId: string;
  projectId: string;
};

export async function requireJobAccess(
  _req: NextRequest,
  jobId?: string
): Promise<JobAccess | NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, project: { userId } },
    select: { id: true, projectId: true },
  });

  if (!job) {
    // Mask unauthorized access as missing to avoid tenant leakage.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return { userId, jobId: job.id, projectId: job.projectId };
}
