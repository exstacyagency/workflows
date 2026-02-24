import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = params;
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const rows = await prisma.$queryRaw<Array<{ totalAssets: number; assetsWithOcr: number }>>`
      SELECT
        COUNT(*)::int AS "totalAssets",
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(COALESCE("rawJson"->>'ocrText', '')), '') IS NOT NULL
        )::int AS "assetsWithOcr"
      FROM "ad_asset"
      WHERE "projectId" = ${projectId}
        AND "platform" = CAST('TIKTOK' AS "AdPlatform")
    `;

    const counts = rows[0] ?? { totalAssets: 0, assetsWithOcr: 0 };
    return NextResponse.json({
      success: true,
      totalAssets: counts.totalAssets ?? 0,
      assetsWithOcr: counts.assetsWithOcr ?? 0,
    });
  } catch (error) {
    console.error("Error fetching ad OCR status:", error);
    return NextResponse.json(
      { error: "Failed to fetch ad OCR status" },
      { status: 500 }
    );
  }
}
