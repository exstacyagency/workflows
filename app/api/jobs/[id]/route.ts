import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJobAccess } from "@/lib/auth/requireJobAccess";

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireJobAccess(req, params.id);
  if (access instanceof NextResponse) return access;

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      projectId: true,
      type: true,
      status: true,
      payload: true,
      resultSummary: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      estimatedCost: true,
      actualCost: true,
      costBreakdown: true,
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job }, { status: 200 });
}
