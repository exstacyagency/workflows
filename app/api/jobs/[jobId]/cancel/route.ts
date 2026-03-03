// app/api/jobs/[jobId]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db";
import { JobStatus } from "@prisma/client";
import { notifyAll } from "@/lib/notifications/notifyAll";

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const session = await requireSession(req);

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findUnique({
    where: {
      id_userId: {
        id: params.jobId,
        userId: session.user.id,
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  if (job.status !== JobStatus.PENDING && job.status !== JobStatus.RUNNING) {
    return NextResponse.json(
      { error: "Only pending or running jobs can be cancelled." },
      { status: 400 },
    );
  }

  await prisma.job.update({
    where: { id: params.jobId },
    data: {
      status: JobStatus.FAILED,
      payload: {
        ...(job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {}),
        cancelRequested: true,
        cancelRequestedAt: new Date().toISOString(),
        cancelRequestedBy: session.user.id,
        cancelReason: "Job cancelled by user",
      } as any,
      error: "Job cancelled by user",
      updatedAt: new Date(),
    },
  });

  await notifyAll({
    jobId: params.jobId,
    jobType: String(job.type),
    projectId: job.projectId,
    runId: job.runId ?? null,
    status: "CANCELLED",
    message: `🛑 ${String(job.type).toLowerCase().replace(/_/g, " ")} cancelled by user`,
    error: "Job cancelled by user",
  });

  return NextResponse.json({ success: true });
}
