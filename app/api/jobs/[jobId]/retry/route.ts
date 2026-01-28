// app/api/jobs/[jobId]/retry/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const session = await requireSession(req);

  if (!session || !session.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
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
    // IMPORTANT: hide existence
    return NextResponse.json(
      { error: "Not Found" },
      { status: 404 }
    );
  }

  // enqueue retry here
  // await enqueueJob(job)

  return NextResponse.json({ ok: true });
}