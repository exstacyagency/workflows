import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";

export const runtime = "nodejs";

type ProductRow = {
  name: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function extractAvatarSummary(resultSummary: unknown): string | null {
  const summaryContainer = asObject(resultSummary);
  if (!summaryContainer) return null;

  const summary = summaryContainer.summary;
  const summaryText = asString(summary);
  if (summaryText) return summaryText;

  const summaryObject = asObject(summary);
  const avatar = asObject(summaryObject?.avatar);
  const primaryPain = asString(avatar?.primaryPain);
  const primaryGoal = asString(avatar?.primaryGoal);

  const parts = [
    primaryPain ? `Pain: ${primaryPain}` : null,
    primaryGoal ? `Goal: ${primaryGoal}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(" | ") : null;
}

function extractProductNameFromPayload(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;

  const direct =
    asString(root.productName) ||
    asString(root.product_name) ||
    asString(root.productTitle) ||
    null;
  if (direct) return direct;

  const result = asObject(root.result);
  const intel = asObject(result?.intel);
  return (
    asString(intel?.productName) ||
    asString(intel?.product_name) ||
    null
  );
}

async function lookupProductName(projectId: string, payload: unknown): Promise<string | null> {
  const root = asObject(payload);
  const productId = asString(root?.productId);
  if (!productId) return null;

  try {
    const rows = await prisma.$queryRaw<ProductRow[]>`
      SELECT "name"
      FROM "product"
      WHERE "project_id" = ${projectId}
        AND "id" = ${productId}
      LIMIT 1
    `;
    return asString(rows[0]?.name);
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string; runId: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const projectId = String(params?.projectId || "").trim();
    const runId = String(params?.runId || "").trim();
    if (!projectId || !runId) {
      return NextResponse.json({ error: "projectId and runId are required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId,
      },
      select: {
        id: true,
        name: true,
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true },
    });
    if (!run || run.projectId !== projectId) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const [customerAnalysisJob, patternAnalysisJob, productCollectionJob] = await Promise.all([
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.CUSTOMER_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          resultSummary: true,
        },
      }),
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
        },
      }),
      prisma.job.findFirst({
        where: {
          projectId,
          runId,
          type: JobType.PRODUCT_DATA_COLLECTION,
          status: JobStatus.COMPLETED,
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          updatedAt: true,
          payload: true,
        },
      }),
    ]);

    const avatarSummary = extractAvatarSummary(customerAnalysisJob?.resultSummary);
    let productName = extractProductNameFromPayload(productCollectionJob?.payload);
    if (!productName && productCollectionJob) {
      productName = await lookupProductName(projectId, productCollectionJob.payload);
    }
    if (!productName) {
      productName = project.name;
    }

    return NextResponse.json(
      {
        success: true,
        runId,
        customerAnalysis: {
          present: Boolean(customerAnalysisJob),
          jobId: customerAnalysisJob?.id ?? null,
          completedAt: toIsoString(customerAnalysisJob?.updatedAt),
          avatarSummary: avatarSummary ?? null,
        },
        patternAnalysis: {
          present: Boolean(patternAnalysisJob),
          jobId: patternAnalysisJob?.id ?? null,
          completedAt: toIsoString(patternAnalysisJob?.updatedAt),
        },
        productCollection: {
          present: Boolean(productCollectionJob),
          jobId: productCollectionJob?.id ?? null,
          completedAt: toIsoString(productCollectionJob?.updatedAt),
          productName: productCollectionJob ? productName : null,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to fetch run summary" },
      { status: 500 },
    );
  }
}
