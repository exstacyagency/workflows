import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { z } from "zod";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { ensureProductTableColumns, findOwnedProductById } from "@/lib/productStore";

const StartCharacterPipelineSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  manualDescription: z.string().trim().max(1200).optional().nullable(),
});
const CREATOR_AVATAR_JOB_TYPE = "CREATOR_AVATAR_GENERATION" as JobType;

type ExistingPipelineJobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: Date;
};

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = StartCharacterPipelineSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const productId = parsed.data.productId;
    const manualDescription = parsed.data.manualDescription?.trim() || null;

    await ensureProductTableColumns();

    const product = await findOwnedProductById(productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const existing = await prisma.$queryRaw<ExistingPipelineJobRow[]>`
      SELECT
        j."id",
        j."type",
        j."status",
        j."createdAt"
      FROM "job" j
      WHERE j."projectId" = ${product.projectId}
        AND j."userId" = ${userId}
        AND j."status" IN (CAST('PENDING' AS "JobStatus"), CAST('RUNNING' AS "JobStatus"))
        AND j."type" IN (
          CAST('CREATOR_AVATAR_GENERATION' AS "JobType"),
          CAST('CHARACTER_SEED_VIDEO' AS "JobType"),
          CAST('CHARACTER_REFERENCE_VIDEO' AS "JobType")
        )
        AND COALESCE(j."payload"->>'productId', '') = ${productId}
      ORDER BY j."createdAt" DESC
      LIMIT 1
    `;

    if (existing[0]) {
      return NextResponse.json(
        {
          jobId: existing[0].id,
          type: existing[0].type,
          status: existing[0].status,
          reused: true,
        },
        { status: 200 },
      );
    }

    const idempotencyKey = JSON.stringify([
      product.projectId,
      "character-pipeline",
      productId,
      Date.now(),
      randomUUID(),
    ]);

    const createdJob = await prisma.job.create({
      data: {
        projectId: product.projectId,
        userId,
        type: CREATOR_AVATAR_JOB_TYPE,
        status: JobStatus.PENDING,
        idempotencyKey,
        payload: {
          projectId: product.projectId,
          productId,
          manualDescription,
          pipeline: "character_generation_v2",
        },
      },
      select: {
        id: true,
        type: true,
        status: true,
      },
    });

    return NextResponse.json(
      {
        jobId: createdJob.id,
        type: createdJob.type,
        status: createdJob.status,
        started: true,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[character-generation/start] Error:", error);
    return NextResponse.json(
      { error: "Failed to start character generation pipeline" },
      { status: 500 },
    );
  }
}
