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

export async function DELETE(request: Request, { params }: Params) {
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

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const assetId = String(body?.assetId || "").trim();
  const assetIds = Array.isArray(body?.assetIds)
    ? body.assetIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
    : [];
  const deleteAll = body?.deleteAll === true;
  if (!assetId && assetIds.length === 0 && !deleteAll) {
    return NextResponse.json(
      { error: "assetId, assetIds, or deleteAll is required" },
      { status: 400 },
    );
  }

  try {
    if (deleteAll) {
      const deleted = await prisma.adAsset.deleteMany({
        where: {
          projectId,
          job: { is: { runId } },
        },
      });
      return NextResponse.json({ success: true, deletedCount: deleted.count });
    }

    if (assetIds.length > 0) {
      const deleted = await prisma.adAsset.deleteMany({
        where: {
          id: { in: assetIds },
          projectId,
          job: { is: { runId } },
        },
      });
      return NextResponse.json({ success: true, deletedCount: deleted.count });
    }

    const asset = await prisma.adAsset.findFirst({
      where: {
        id: assetId,
        projectId,
        job: { is: { runId } },
      },
      select: { id: true },
    });

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found for this project/run" },
        { status: 404 },
      );
    }

    await prisma.adAsset.delete({ where: { id: asset.id } });
    return NextResponse.json({ success: true, deletedAssetId: asset.id, deletedCount: 1 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to delete ad asset" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
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

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const assetId = String(body?.assetId || "").trim();
  const clearTranscript = body?.clearTranscript === true;
  const clearOcr = body?.clearOcr === true;

  if (!assetId) {
    return NextResponse.json({ error: "assetId is required" }, { status: 400 });
  }
  if (!clearTranscript && !clearOcr) {
    return NextResponse.json(
      { error: "At least one of clearTranscript or clearOcr must be true" },
      { status: 400 },
    );
  }

  try {
    const asset = await prisma.adAsset.findFirst({
      where: {
        id: assetId,
        projectId,
        job: { is: { runId } },
      },
      select: { id: true, rawJson: true },
    });

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found for this project/run" },
        { status: 404 },
      );
    }

    const raw =
      asset.rawJson && typeof asset.rawJson === "object" && !Array.isArray(asset.rawJson)
        ? (asset.rawJson as Record<string, any>)
        : {};

    let nextRaw: Record<string, any> = { ...raw };

    if (clearTranscript) {
      const {
        transcript: _transcript,
        transcriptWords: _transcriptWords,
        transcriptSource: _transcriptSource,
        ...withoutTranscript
      } = nextRaw;
      nextRaw = withoutTranscript;
    }

    if (clearOcr) {
      const {
        ocrText: _ocrText,
        ocrFrames: _ocrFrames,
        ocrConfidence: _ocrConfidence,
        ...withoutOcr
      } = nextRaw;

      const metrics =
        withoutOcr.metrics && typeof withoutOcr.metrics === "object" && !Array.isArray(withoutOcr.metrics)
          ? (withoutOcr.metrics as Record<string, any>)
          : null;

      if (metrics && "ocr_meta" in metrics) {
        const { ocr_meta: _ocrMeta, ...restMetrics } = metrics;
        nextRaw = {
          ...withoutOcr,
          metrics: restMetrics,
        };
      } else {
        nextRaw = withoutOcr;
      }
    }

    const updated = await prisma.adAsset.update({
      where: { id: asset.id },
      data: { rawJson: nextRaw as any },
      select: { id: true, updatedAt: true, rawJson: true },
    });

    return NextResponse.json({
      success: true,
      assetId: updated.id,
      updatedAt: updated.updatedAt,
      clearTranscript,
      clearOcr,
      rawJson: updated.rawJson,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to clear asset transcript/OCR fields" },
      { status: 500 },
    );
  }
}
