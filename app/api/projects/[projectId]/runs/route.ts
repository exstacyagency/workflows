import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pathProjectId = String(params.projectId || "").trim();
    const body = await req.json().catch(() => ({}));
    const requestedRunId = String(body?.runId || "").trim();
    const bodyProjectId = String(body?.projectId || "").trim();

    if (!pathProjectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    if (bodyProjectId && bodyProjectId !== pathProjectId) {
      return NextResponse.json(
        { error: "projectId in body must match URL" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: pathProjectId,
        userId,
      },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let run;
    if (requestedRunId) {
      const existing = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
      });
      if (existing && existing.projectId !== pathProjectId) {
        return NextResponse.json(
          { error: "runId already exists for a different project" },
          { status: 409 }
        );
      }
      run =
        existing ??
        (await prisma.researchRun.create({
          data: {
            id: requestedRunId,
            projectId: pathProjectId,
            status: "IN_PROGRESS",
          },
        }));
    } else {
      run = await prisma.researchRun.create({
        data: {
          id: randomUUID(),
          projectId: pathProjectId,
          status: "IN_PROGRESS",
        },
      });
    }

    return NextResponse.json({ success: true, run }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create run" },
      { status: 500 }
    );
  }
}
