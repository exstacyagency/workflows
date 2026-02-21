import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = asObject(await req.json()) ?? {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const projectId = asString(body.projectId);
    const storyboardId = asString(body.storyboardId);
    const requestedProductId = asString(body.productId);
    const requestedRunId = asString(body.runId);
    let effectiveRunId: string | null = null;
    let effectiveProductId: string | null = null;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!storyboardId) {
      return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
    }

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    if (requestedRunId) {
      const existingRun = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
        select: { id: true, projectId: true },
      });
      if (!existingRun || existingRun.projectId !== projectId) {
        return NextResponse.json({ error: "runId not found for this project" }, { status: 400 });
      }
      effectiveRunId = existingRun.id;
    }

    if (requestedProductId) {
      const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "product"
        WHERE "id" = ${requestedProductId}
          AND "project_id" = ${projectId}
        LIMIT 1
      `;
      if (!productRows[0]?.id) {
        return NextResponse.json({ error: "productId not found for this project" }, { status: 400 });
      }
      effectiveProductId = requestedProductId;
    }

    const storyboard = await prisma.storyboard.findFirst({
      where: {
        id: storyboardId,
        projectId,
      },
      select: { id: true },
    });
    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard not found for project." }, { status: 404 });
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.IMAGE_PROMPT_GENERATION,
      storyboardId,
      Date.now(),
    ]);

    const job = await prisma.job.create({
      data: {
        userId,
        projectId,
        type: JobType.IMAGE_PROMPT_GENERATION,
        status: JobStatus.PENDING,
        idempotencyKey,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        payload: {
          projectId,
          storyboardId,
          ...(effectiveProductId ? { productId: effectiveProductId } : {}),
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          idempotencyKey,
        },
      },
      select: { id: true, runId: true },
    });

    return NextResponse.json(
      { jobId: job.id, runId: job.runId ?? effectiveRunId, queued: true },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create image prompt generation job" },
      { status: 500 },
    );
  }
}
