import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { isAdminRequest } from "@/lib/admin/isAdminRequest";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Dead-letter is operational/admin surface area. Project owners should not have access by default.
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { projectId } = params;
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

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
  } catch (err: any) {
    // Always return 403 for non-admins, 404 for missing project, never 500
    if (err?.message?.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err?.message?.includes("Not found") || err?.message?.includes("projectId")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}
