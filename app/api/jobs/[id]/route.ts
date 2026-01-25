import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Pass req as NextRequest for test token support
  const userId = await getSessionUserId(req as any);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let job = null;
  try {
    job = await prisma.job.findFirst({
      where: { id: params.id, project: { userId } },
      select: {
        id: true,
        status: true,
        currentStep: true,
        resultSummary: true,
        error: true,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}
