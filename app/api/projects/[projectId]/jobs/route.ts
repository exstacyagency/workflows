import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = params;
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type");

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: userId,
      },
      select: {
        id: true,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const whereClause: any = {
      projectId,
      userId: userId,
    };

    // Add type filter if provided
    if (typeFilter) {
      whereClause.type = typeFilter;
    }

    const jobs = await prisma.job.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        type: true,
        status: true,
        error: true,
        resultSummary: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
        runId: true,
      },
    });

    return NextResponse.json({
      success: true,
      jobs,
      count: jobs.length,
    });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
