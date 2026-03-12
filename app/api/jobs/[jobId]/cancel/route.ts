// app/api/jobs/[jobId]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db";
import { JobStatus } from "@prisma/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const awaitedParams = await params;
  const session = await requireSession(req);

  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await prisma.job.findUnique({
    where: {
      id_userId: {
        id: awaitedParams.jobId,
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
    where: { id: awaitedParams.jobId },
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

  return NextResponse.json({ success: true });
}
