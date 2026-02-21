import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { prisma } from "@/lib/prisma";
import { ensureStoryboardSceneApprovalColumn } from "@/lib/productStore";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractSceneFrameUrls(rawValue: unknown): {
  firstFrameImageUrl: string | null;
  lastFrameImageUrl: string | null;
} {
  const raw = asObject(rawValue) ?? {};

  const firstFromRaw =
    asString(raw.firstFrameImageUrl) ||
    asString(raw.firstFrameUrl) ||
    asString(raw.first_frame_url);
  const lastFromRaw =
    asString(raw.lastFrameImageUrl) ||
    asString(raw.lastFrameUrl) ||
    asString(raw.last_frame_url);

  let firstFrameImageUrl = firstFromRaw || null;
  let lastFrameImageUrl = lastFromRaw || null;

  const images = Array.isArray(raw.images)
    ? raw.images
    : Array.isArray((asObject(raw.polled) ?? {}).images)
      ? ((asObject(raw.polled) ?? {}).images as unknown[])
      : [];

  for (const image of images) {
    const imageObj = asObject(image) ?? {};
    const imageUrl = asString(imageObj.url);
    if (!imageUrl) continue;
    const kind = asString(imageObj.promptKind || imageObj.frameType).toLowerCase();
    if (kind === "last") {
      lastFrameImageUrl = lastFrameImageUrl || imageUrl;
    } else {
      firstFrameImageUrl = firstFrameImageUrl || imageUrl;
    }
  }

  if (!lastFrameImageUrl && firstFrameImageUrl) {
    lastFrameImageUrl = firstFrameImageUrl;
  }

  return {
    firstFrameImageUrl,
    lastFrameImageUrl,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { storyboardId: string; sceneNumber: string } },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureStoryboardSceneApprovalColumn();

    const storyboardId = asString(params?.storyboardId);
    if (!storyboardId) {
      return NextResponse.json({ error: "storyboardId is required" }, { status: 400 });
    }

    const sceneNumber = Number(params?.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      return NextResponse.json({ error: "sceneNumber must be a positive integer" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const bodyObject = asObject(body) ?? {};
    const approved = bodyObject.approved === false ? false : true;

    const scene = await prisma.storyboardScene.findFirst({
      where: {
        storyboardId,
        sceneNumber,
        storyboard: {
          project: {
            userId,
          },
        },
      },
      select: {
        id: true,
        rawJson: true,
      },
    });

    if (!scene) {
      return NextResponse.json({ error: "Scene not found" }, { status: 404 });
    }

    if (approved) {
      const { firstFrameImageUrl, lastFrameImageUrl } = extractSceneFrameUrls(scene.rawJson);
      if (!firstFrameImageUrl || !lastFrameImageUrl) {
        return NextResponse.json(
          { error: "Scene must have generated first and last frame images before approval." },
          { status: 409 },
        );
      }
    }

    await prisma.$executeRaw`
      UPDATE "storyboard_scene"
      SET "approved" = ${approved},
          "updatedAt" = NOW()
      WHERE "id" = ${scene.id}
    `;

    return NextResponse.json({
      success: true,
      storyboardId,
      sceneNumber,
      approved,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update scene approval" },
      { status: 500 },
    );
  }
}
