import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

const CREATIVE_JOB_TYPES: JobType[] = [
  JobType.SCRIPT_GENERATION,
  JobType.STORYBOARD_GENERATION,
  "IMAGE_PROMPT_GENERATION" as JobType,
  JobType.VIDEO_IMAGE_GENERATION,
  JobType.VIDEO_PROMPT_GENERATION,
  JobType.VIDEO_GENERATION,
  JobType.VIDEO_REVIEW,
  JobType.VIDEO_UPSCALER,
];

type Params = { params: { projectId: string; runId: string } };

async function validateAccess(projectId: string, runId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json(
      { error: "Project not found or access denied" },
      { status: 404 },
    );
  }

  const run = await prisma.researchRun.findFirst({
    where: { id: runId, projectId },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json(
      { error: "Run not found for this project" },
      { status: 404 },
    );
  }

  return null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(params.projectId || "").trim();
  const runId = String(params.runId || "").trim();
  if (!projectId || !runId) {
    return NextResponse.json({ error: "projectId and runId required" }, { status: 400 });
  }

  const accessError = await validateAccess(projectId, runId, userId);
  if (accessError) return accessError;

  const jobs = await prisma.job.findMany({
    where: {
      projectId,
      userId,
      runId,
      type: { in: CREATIVE_JOB_TYPES },
    },
    orderBy: { createdAt: "desc" },
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
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(params.projectId || "").trim();
  const runId = String(params.runId || "").trim();
  if (!projectId || !runId) {
    return NextResponse.json({ error: "projectId and runId required" }, { status: 400 });
  }

  const accessError = await validateAccess(projectId, runId, userId);
  if (accessError) return accessError;

  let body: { jobIds?: unknown; deleteAll?: unknown } = {};
  try {
    body = (await req.json()) as { jobIds?: unknown; deleteAll?: unknown };
  } catch {
    // Optional body.
  }

  const deleteAll = body.deleteAll === true;
  const requestedIds = Array.isArray(body.jobIds)
    ? body.jobIds
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];

  if (!deleteAll && requestedIds.length === 0) {
    return NextResponse.json(
      { error: "Provide jobIds or set deleteAll=true" },
      { status: 400 },
    );
  }

  const targetJobs = await prisma.job.findMany({
    where: {
      projectId,
      userId,
      runId,
      type: { in: CREATIVE_JOB_TYPES },
      ...(deleteAll ? {} : { id: { in: requestedIds } }),
    },
    select: { id: true },
  });

  const targetIds = targetJobs.map((job) => job.id);
  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "No matching creative jobs found for deletion" },
      { status: 404 },
    );
  }

  const deletedJobs = await prisma.$transaction(async (tx) => {
    const scripts = await tx.script.findMany({
      where: { jobId: { in: targetIds } },
      select: { id: true },
    });
    const scriptIds = scripts.map((script) => script.id);

    const storyboardWhere: { OR: Array<Record<string, unknown>> } = { OR: [] };
    storyboardWhere.OR.push({ jobId: { in: targetIds } });
    if (scriptIds.length > 0) {
      storyboardWhere.OR.push({ scriptId: { in: scriptIds } });
    }
    await tx.storyboard.deleteMany({ where: storyboardWhere });

    await tx.script.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.auditLog.deleteMany({ where: { jobId: { in: targetIds } } });

    const deleted = await tx.job.deleteMany({
      where: {
        id: { in: targetIds },
        projectId,
        userId,
        runId,
        type: { in: CREATIVE_JOB_TYPES },
      },
    });

    return deleted.count;
  });

  return NextResponse.json({
    success: true,
    deletedJobs,
    runId,
  });
}
