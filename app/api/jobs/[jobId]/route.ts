
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db";


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const awaitedParams = await params;
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
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
    // IMPORTANT: hide existence
    return NextResponse.json(
      { error: "Not Found" },
      { status: 404 }
    );
  }

  return NextResponse.json(job, { status: 200 });
}
