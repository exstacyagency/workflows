import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { prisma } from "@/lib/prisma";

type Params = {
  params: {
    projectId: string;
    runId: string;
  };
};

export async function GET(_request: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = String(params.projectId || "").trim();
  const runId = String(params.runId || "").trim();

  if (!projectId || !runId) {
    return NextResponse.json({ error: "projectId and runId are required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  try {
    type AssetRow = {
      id: string;
      jobId: string | null;
      platform: string;
      isSwipeFile: boolean | null;
      swipeMetadata: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
      retention_3s: number | null;
      retention_10s: number | null;
      retention_3s_ctr: number | null;
      retention_10s_ctr: number | null;
      retention_3s_cvr: number | null;
      retention_10s_cvr: number | null;
      duration: number | null;
      source_type: string | null;
      engagement_score: number | null;
      rawJson: Prisma.JsonValue;
    };
    const assets = await prisma.$queryRaw<AssetRow[]>(
      Prisma.sql`
        SELECT
          a."id",
          a."jobId",
          a."platform",
          a."isSwipeFile",
          a."swipeMetadata",
          a."createdAt",
          a."updatedAt",
          a."retention_3s",
          a."retention_10s",
          a."retention_3s_ctr",
          a."retention_10s_ctr",
          a."retention_3s_cvr",
          a."retention_10s_cvr",
          a."duration",
          a."source_type",
          a."engagement_score",
          a."rawJson"
        FROM "ad_asset" a
        LEFT JOIN "job" j ON j."id" = a."jobId"
        WHERE a."projectId" = ${projectId}
          AND j."runId" = ${runId}
        ORDER BY a."createdAt" DESC
      `
    );

    return NextResponse.json({
      success: true,
      projectId,
      runId,
      count: assets.length,
      assets,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load ad assets" },
      { status: 500 },
    );
  }
}
