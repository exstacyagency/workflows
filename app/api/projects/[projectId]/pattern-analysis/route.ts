// app/api/projects/[projectId]/pattern-analysis/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const awaitedParams = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = awaitedParams;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() || null;
  const runId = req.nextUrl.searchParams.get("runId")?.trim() || null;

  const result = await prisma.adPatternResult.findFirst({
    where: {
      projectId,
      ...(jobId ? { jobId } : {}),
      ...(runId ? { job: { is: { runId } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          runId: true,
          payload: true,
          resultSummary: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!result) {
    return NextResponse.json(
      { error: "No pattern analysis found for this selection" },
      { status: 404 },
    );
  }

  const data = (result.rawJson as Record<string, unknown> | null) ?? {};
  return NextResponse.json(
    {
      id: result.id,
      projectId: result.projectId,
      baselineRetention3s: data.baselineRetention3s,
      baselineCtr: data.baselineCtr,
      totalConverters: data.totalConverters,
      rawJson: result.rawJson,
      summary: result.summary,
      createdAt: result.createdAt,
      job: result.job,
    },
    { status: 200 },
  );
}
