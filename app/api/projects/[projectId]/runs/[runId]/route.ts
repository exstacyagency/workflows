import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export const runtime = "nodejs";

type UpdatedRunRow = {
  id: string;
  projectId: string;
  name: string | null;
  status: string;
  createdAt: Date;
};

async function validateRunAccess(projectId: string, runId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: { id: true },
  });
  if (!project) {
    return { ok: false as const, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  }

  const run = await prisma.researchRun.findUnique({
    where: { id: runId },
    select: { id: true, projectId: true },
  });
  if (!run || run.projectId !== projectId) {
    return { ok: false as const, response: NextResponse.json({ error: "Run not found" }, { status: 404 }) };
  }

  return { ok: true as const };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string; runId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const projectId = String(params.projectId || "").trim();
    const runId = String(params.runId || "").trim();
    if (!projectId || !runId) {
      return NextResponse.json({ error: "projectId and runId required" }, { status: 400 });
    }

    const access = await validateRunAccess(projectId, runId, userId);
    if (!access.ok) {
      return access.response;
    }

    const body = await req.json().catch(() => ({}));
    const nameRaw = typeof body?.name === "string" ? body.name : "";
    const name = nameRaw.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ error: "name must be 120 characters or fewer" }, { status: 400 });
    }

    const updatedRows = await prisma.$queryRaw<UpdatedRunRow[]>(
      Prisma.sql`
        UPDATE "research_run"
        SET "name" = ${name}
        WHERE "id" = ${runId}
          AND "projectId" = ${projectId}
        RETURNING
          "id",
          "projectId",
          "name",
          "status"::text AS "status",
          "createdAt"
      `,
    );

    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, run: updated }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to rename run" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectId: string; runId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const projectId = String(params.projectId || "").trim();
    const runId = String(params.runId || "").trim();
    if (!projectId || !runId) {
      return NextResponse.json({ error: "projectId and runId required" }, { status: 400 });
    }

    const access = await validateRunAccess(projectId, runId, userId);
    if (!access.ok) {
      return access.response;
    }

    const deletedJobsCount = await prisma.$transaction(async (tx) => {
      const jobs = await tx.job.findMany({
        where: { projectId, runId },
        select: { id: true },
      });
      const jobIds = jobs.map((job) => job.id);

      if (jobIds.length > 0) {
        const scripts = await tx.script.findMany({
          where: { jobId: { in: jobIds } },
          select: { id: true },
        });
        const scriptIds = scripts.map((script) => script.id);

        const storyboardWhere: { OR: Array<Record<string, unknown>> } = { OR: [] };
        storyboardWhere.OR.push({ jobId: { in: jobIds } });
        if (scriptIds.length > 0) {
          storyboardWhere.OR.push({ scriptId: { in: scriptIds } });
        }
        await tx.storyboard.deleteMany({ where: storyboardWhere });

        await tx.script.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.researchRow.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.amazonReview.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.adAsset.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.adPatternResult.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.auditLog.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.character.deleteMany({ where: { jobId: { in: jobIds } } });
        await tx.productIntel.deleteMany({ where: { jobId: { in: jobIds } } });
      }

      const deletedJobs = await tx.job.deleteMany({
        where: { projectId, runId },
      });

      await tx.researchRun.delete({
        where: { id: runId },
      });

      return deletedJobs.count;
    });

    return NextResponse.json(
      { success: true, deletedRunId: runId, deletedJobs: deletedJobsCount },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to delete run" },
      { status: 500 },
    );
  }
}
