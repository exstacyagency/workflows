import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  const job = await prisma.job.findUnique({
    where: { id },
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

  const auth = await requireProjectOwner(job.projectId);
  if (auth.error) {
    // Return 404 to avoid leaking existence across tenants/users
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job }, { status: 200 });
}
