import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { ensureProductTableColumns, findOwnedProductById } from "@/lib/productStore";
import { prisma } from "@/lib/prisma";

type PipelineJobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  error: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const CREATOR_AVATAR_JOB_TYPE = "CREATOR_AVATAR_GENERATION" as JobType;
const CHARACTER_SEED_VIDEO_JOB_TYPE = "CHARACTER_SEED_VIDEO" as JobType;
const CHARACTER_REFERENCE_VIDEO_JOB_TYPE = "CHARACTER_REFERENCE_VIDEO" as JobType;

const STAGE_ORDER: JobType[] = [
  CREATOR_AVATAR_JOB_TYPE,
  CHARACTER_SEED_VIDEO_JOB_TYPE,
  CHARACTER_REFERENCE_VIDEO_JOB_TYPE,
];

const STAGE_LABELS: Record<string, string> = {
  [CREATOR_AVATAR_JOB_TYPE]: "Creator Avatar Generation",
  [CHARACTER_SEED_VIDEO_JOB_TYPE]: "Character Seed Video",
  [CHARACTER_REFERENCE_VIDEO_JOB_TYPE]: "Character Reference Video",
};

function toErrorString(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const productId = req.nextUrl.searchParams.get("productId")?.trim();
    const runId = req.nextUrl.searchParams.get("runId")?.trim() || null;
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    await ensureProductTableColumns();

    const product = await findOwnedProductById(productId, userId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (!runId) {
      const stages = STAGE_ORDER.map((type) => ({
        type,
        label: STAGE_LABELS[String(type)] ?? type,
        jobId: null,
        status: "PENDING" as const,
        error: null,
        createdAt: null,
        updatedAt: null,
      }));

      return NextResponse.json(
        {
          productId: product.id,
          projectId: product.projectId,
          runId: null,
          isComplete: false,
          activeStage: null,
          stages,
          character: {
            soraCharacterId: null,
            characterUserName: null,
            characterReferenceVideoUrl: null,
            characterCameoCreatedAt: null,
          },
        },
        { status: 200 },
      );
    }

    const jobs = await prisma.$queryRaw<PipelineJobRow[]>`
      SELECT
        j."id",
        j."type",
        j."status",
        j."error",
        j."createdAt",
        j."updatedAt"
      FROM "job" j
      WHERE j."projectId" = ${product.projectId}
        AND j."userId" = ${userId}
        AND j."runId" = ${runId}
        AND j."type" IN (
          CAST('CREATOR_AVATAR_GENERATION' AS "JobType"),
          CAST('CHARACTER_SEED_VIDEO' AS "JobType"),
          CAST('CHARACTER_REFERENCE_VIDEO' AS "JobType")
        )
        AND COALESCE(j."payload"->>'productId', '') = ${productId}
      ORDER BY j."createdAt" DESC
    `;

    const latestByType = new Map<JobType, PipelineJobRow>();
    for (const row of jobs) {
      if (!latestByType.has(row.type)) {
        latestByType.set(row.type, row);
      }
    }

    const stages = STAGE_ORDER.map((type) => {
      const row = latestByType.get(type);
      return {
        type,
        label: STAGE_LABELS[String(type)] ?? type,
        jobId: row?.id ?? null,
        status: row?.status ?? "PENDING",
        error: toErrorString(row?.error),
        createdAt: row?.createdAt ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    const activeStage =
      stages.find((stage) => stage.status === JobStatus.RUNNING) ??
      stages.find((stage) => stage.status === JobStatus.PENDING && stage.jobId);

    const runCharacter = await prisma.character.findFirst({
      where: {
        productId: product.id,
        runId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        soraCharacterId: true,
        characterUserName: true,
        seedVideoUrl: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        productId: product.id,
        projectId: product.projectId,
        runId,
        isComplete: Boolean(runCharacter?.soraCharacterId),
        activeStage: activeStage?.type ?? null,
        stages,
        character: {
          soraCharacterId: runCharacter?.soraCharacterId ?? null,
          characterUserName: runCharacter?.characterUserName ?? null,
          characterReferenceVideoUrl: runCharacter?.seedVideoUrl ?? null,
          characterCameoCreatedAt: runCharacter?.createdAt ?? null,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[character-generation/status] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch character generation status" },
      { status: 500 },
    );
  }
}
