import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

type ResultSummary = {
  summary?: unknown;
  avatarId?: unknown;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = String(params?.projectId || "").trim();
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const jobs = await prisma.job.findMany({
      where: {
        projectId,
        userId,
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.COMPLETED,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        runId: true,
        createdAt: true,
        updatedAt: true,
        resultSummary: true,
      },
    });

    const runs = jobs
      .map((job) => {
        const summary =
          job.resultSummary && typeof job.resultSummary === "object"
            ? (job.resultSummary as ResultSummary)
            : null;
        const avatarId =
          typeof summary?.avatarId === "string" ? summary.avatarId : null;
        const summaryText =
          typeof summary?.summary === "string" ? summary.summary : null;
        return {
          jobId: job.id,
          runId: job.runId ?? null,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          avatarId,
          summary: summaryText,
        };
      })
      .filter((run) => Boolean(run.avatarId));

    return NextResponse.json(
      {
        success: true,
        runs,
        count: runs.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to fetch research runs", error);
    return NextResponse.json({ error: "Failed to fetch research runs" }, { status: 500 });
  }
}
