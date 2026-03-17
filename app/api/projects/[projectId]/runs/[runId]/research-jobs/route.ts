import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

const RESEARCH_JOB_TYPES: JobType[] = [
  JobType.CUSTOMER_RESEARCH,
  JobType.CUSTOMER_ANALYSIS,
  JobType.AD_PERFORMANCE,
  JobType.AD_QUALITY_GATE,
  JobType.PATTERN_ANALYSIS,
  JobType.PRODUCT_DATA_COLLECTION,
  JobType.PRODUCT_ANALYSIS,
];

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const awaitedParams = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(awaitedParams.projectId || "").trim();
  const runId = String(awaitedParams.runId || "").trim();
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
      type: { in: RESEARCH_JOB_TYPES },
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const awaitedParams = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(awaitedParams.projectId || "").trim();
  const runId = String(awaitedParams.runId || "").trim();
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
    ? body.jobIds.map((entry) => String(entry || "").trim()).filter(Boolean)
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
      type: { in: RESEARCH_JOB_TYPES },
      ...(deleteAll ? {} : { id: { in: requestedIds } }),
    },
    select: { id: true },
  });

  const targetIds = targetJobs.map((job) => job.id);
  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "No matching research jobs found for deletion" },
      { status: 404 },
    );
  }

  const deletedJobs = await prisma.$transaction(async (tx) => {
    await tx.researchRow.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.amazonReview.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.adAsset.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.adPatternResult.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.auditLog.deleteMany({ where: { jobId: { in: targetIds } } });
    await tx.productIntel.deleteMany({ where: { jobId: { in: targetIds } } });

    const deleted = await tx.job.deleteMany({
      where: {
        id: { in: targetIds },
        projectId,
        userId,
        runId,
        type: { in: RESEARCH_JOB_TYPES },
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
