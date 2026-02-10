import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const {
      projectId: rawProjectId,
      productId: rawProductId,
      productName: rawProductName,
      productUrl: rawProductUrl,
      returnsUrl: rawReturnsUrl,
      shippingUrl: rawShippingUrl,
      aboutUrl: rawAboutUrl,
      faqUrl: rawFaqUrl,
      standardsUrl: rawStandardsUrl,
      runId: rawRunId,
    } = (body ?? {}) as Record<string, unknown>;
    const projectId = String(rawProjectId ?? "").trim();
    const productUrl = String(rawProductUrl ?? "").trim();
    const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";
    const productName = typeof rawProductName === "string" ? rawProductName.trim() : "";
    const returnsUrl =
      typeof rawReturnsUrl === "string"
        ? rawReturnsUrl.trim()
        : typeof rawFaqUrl === "string"
          ? rawFaqUrl.trim()
          : "";
    const shippingUrl = typeof rawShippingUrl === "string" ? rawShippingUrl.trim() : "";
    const aboutUrl =
      typeof rawAboutUrl === "string"
        ? rawAboutUrl.trim()
        : typeof rawStandardsUrl === "string"
          ? rawStandardsUrl.trim()
          : "";
    const runId = typeof rawRunId === "string" ? rawRunId.trim() : "";

    if (!projectId || !productUrl) {
      return NextResponse.json(
        { error: "projectId and productUrl required" },
        { status: 400 }
      );
    }

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const run = await prisma.researchRun.create({
        data: {
          projectId,
          status: "IN_PROGRESS",
        },
      });
      effectiveRunId = run.id;
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.PRODUCT_DATA_COLLECTION,
        status: JobStatus.PENDING,
        idempotencyKey: randomUUID(),
        runId: effectiveRunId,
        payload: {
          projectId,
          ...(productId ? { productId } : {}),
          ...(productName ? { productName } : {}),
          productUrl,
          returnsUrl: returnsUrl || null,
          shippingUrl: shippingUrl || null,
          aboutUrl: aboutUrl || null,
          runId: effectiveRunId,
        },
        error: Prisma.JsonNull,
      },
    });

    return NextResponse.json({
      jobId: job.id,
      runId: effectiveRunId,
      started: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create product data collection job" },
      { status: 500 }
    );
  }
}
