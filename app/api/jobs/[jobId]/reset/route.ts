// app/api/jobs/[jobId]/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db";
import { JobStatus } from "@prisma/client";

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } },
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

  await prisma.job.update({
    where: { id: params.jobId },
    data: {
      status: JobStatus.FAILED,
      error: "Manual reset",
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
