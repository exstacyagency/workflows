import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { isAdminRequest } from "@/lib/admin/isAdminRequest";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Dead-letter is operational/admin surface area. Project owners should not have access by default.
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { projectId } = params;
  // Optional: still require ownership even for admins by uncommenting:
  // const auth = await requireProjectOwner(projectId);
  // if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const jobs = await prisma.job.findMany({
    where: { projectId, status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      status: true,
      error: true,
      resultSummary: true,
      payload: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const rows = jobs
    .map((j) => {
      const p: any = j.payload ?? {};
      return {
        ...j,
        attempts: Number(p.attempts ?? 0),
        nextRunAt: p.nextRunAt ?? null,
        lastError: p.lastError ?? null,
        dismissed: Boolean(p.dismissed ?? false),
      };
    })
    .filter((j) => !j.dismissed);

  return NextResponse.json({ jobs: rows }, { status: 200 });
}
