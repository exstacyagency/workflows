import { NextRequest, NextResponse } from "next/server";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import { ensureCreatorLibraryTables, findOwnedProductById } from "@/lib/creatorLibraryStore";
import { POST as startVideoImagesStartPost } from "./start/route";

type StoryboardJobRow = {
  id: string;
  payload: unknown;
  resultSummary: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
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

function getStoryboardIdFromCompletedJob(job: StoryboardJobRow | null): string | null {
  if (!job) return null;

  const payload = asObject(job.payload) ?? {};
  const payloadResult = asObject(payload.result);
  const fromPayloadResult = asString(payloadResult?.storyboardId);
  if (fromPayloadResult) return fromPayloadResult;

  const fromPayload = asString(payload.storyboardId);
  if (fromPayload) return fromPayload;

  const summary = job.resultSummary;
  if (summary && typeof summary === "object") {
    const summaryObj = summary as Record<string, unknown>;
    const fromSummary = asString(summaryObj.storyboardId);
    if (fromSummary) return fromSummary;
    const nestedSummary = asObject(summaryObj.summary);
    const fromNestedSummary = asString(nestedSummary?.storyboardId);
    if (fromNestedSummary) return fromNestedSummary;
  }

  if (typeof summary === "string" && summary.trim()) {
    const match = summary.match(/storyboardId=([^) ,]+)/);
    if (match?.[1]) return match[1];
  }

  return null;
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    body = asObject(raw) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const runId = asString(body.runId);

  const projectId = asString(body.projectId);
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  const productId = asString(body.productId);
  if (!productId) {
    return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  }

  const hasRequestedSceneNumber =
    body.sceneNumber !== undefined && body.sceneNumber !== null && String(body.sceneNumber).trim() !== "";
  const requestedSceneNumberRaw = hasRequestedSceneNumber ? Number(body.sceneNumber) : Number.NaN;
  if (
    hasRequestedSceneNumber &&
    (!Number.isFinite(requestedSceneNumberRaw) ||
      !Number.isInteger(requestedSceneNumberRaw) ||
      requestedSceneNumberRaw < 1)
  ) {
    return NextResponse.json({ error: "sceneNumber must be a positive integer when provided." }, { status: 400 });
  }
  const requestedSceneNumber =
    hasRequestedSceneNumber
      ? Math.trunc(requestedSceneNumberRaw)
      : null;

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;
  await ensureCreatorLibraryTables();

  const ownedProduct = await findOwnedProductById(productId, userId);
  if (!ownedProduct || ownedProduct.projectId !== projectId) {
    return NextResponse.json({ error: "Product not found for this project." }, { status: 404 });
  }
  const creatorReferenceImageUrl = asString(ownedProduct.creatorReferenceImageUrl);
  if (!creatorReferenceImageUrl) {
    return NextResponse.json(
      {
        error:
          "Image generation requires an active creator reference image. Set product.creatorReferenceImageUrl first.",
      },
      { status: 409 },
    );
  }

  const requestedStoryboardId = asString(body.storyboardId);
  let storyboardId: string | null = requestedStoryboardId || null;
  if (!storyboardId) {
    const latestCompletedStoryboardJob = await prisma.job.findFirst({
      where: {
        userId,
        projectId,
        type: JobType.STORYBOARD_GENERATION,
        status: JobStatus.COMPLETED,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        payload: true,
        resultSummary: true,
      },
    });
    storyboardId = getStoryboardIdFromCompletedJob(latestCompletedStoryboardJob);
  }
  if (!storyboardId) {
    return NextResponse.json(
      { error: "No completed storyboard found for this project. Run Create Storyboard first." },
      { status: 409 },
    );
  }

  const storyboard = await prisma.storyboard.findFirst({
    where: {
      id: storyboardId,
      projectId,
    },
    select: {
      id: true,
      scenes: {
        orderBy: { sceneNumber: "asc" },
        select: {
          id: true,
          sceneNumber: true,
          rawJson: true,
        },
      },
    },
  });

  if (!storyboard) {
    return NextResponse.json(
      { error: "Latest completed storyboard no longer exists." },
      { status: 404 },
    );
  }

  if (!storyboard.scenes.length) {
    return NextResponse.json(
      { error: "Storyboard has no scenes. Regenerate storyboard first." },
      { status: 409 },
    );
  }

  let approvalRows: Array<{ id: string; approved: boolean | null }> = [];
  try {
    approvalRows = await prisma.$queryRaw<Array<{ id: string; approved: boolean | null }>>`
      SELECT "id", "approved"
      FROM "storyboard_scene"
      WHERE "storyboardId" = ${storyboard.id}
    `;
  } catch {
    // Backward compatibility for environments before approval migration is applied.
    approvalRows = [];
  }
  const approvalBySceneId = new Map<string, boolean>();
  for (const row of approvalRows) {
    approvalBySceneId.set(String(row.id), Boolean(row.approved));
  }

  const scenesWithPrompts = storyboard.scenes.map((scene) => {
    const rawJson = asObject(scene.rawJson) ?? {};
    const frameUrls = extractSceneFrameUrls(rawJson);
    return {
      sceneId: asString(scene.id),
      sceneNumber: Number(scene.sceneNumber),
      approved: approvalBySceneId.get(scene.id) ?? Boolean(rawJson.approved),
      firstFramePrompt: asString(rawJson.firstFramePrompt),
      lastFramePrompt: asString(rawJson.lastFramePrompt),
      firstFrameImageUrl: frameUrls.firstFrameImageUrl,
      lastFrameImageUrl: frameUrls.lastFrameImageUrl,
    };
  });

  const missingPromptScenes = scenesWithPrompts
    .filter((entry) => !entry.firstFramePrompt || !entry.lastFramePrompt)
    .map((entry) => entry.sceneNumber);
  if (missingPromptScenes.length > 0) {
    return NextResponse.json(
      {
        error: "Storyboard scenes are missing image prompts. Run Generate Image Prompts first.",
        missingPromptScenes,
      },
      { status: 409 },
    );
  }

  let targetScenes = scenesWithPrompts;
  if (requestedSceneNumber !== null) {
    const targetScene = scenesWithPrompts.find((scene) => scene.sceneNumber === requestedSceneNumber);
    if (!targetScene) {
      return NextResponse.json(
        { error: `Scene ${requestedSceneNumber} not found in storyboard.` },
        { status: 404 },
      );
    }

    if (requestedSceneNumber > 1) {
      const previousScene = scenesWithPrompts.find((scene) => scene.sceneNumber === requestedSceneNumber - 1) ?? null;
      if (!previousScene) {
        return NextResponse.json(
          { error: `Scene ${requestedSceneNumber - 1} is missing; cannot generate Scene ${requestedSceneNumber}.` },
          { status: 409 },
        );
      }
      if (!previousScene.approved) {
        return NextResponse.json(
          {
            error: `Scene ${requestedSceneNumber} is locked. Approve Scene ${requestedSceneNumber - 1} first.`,
          },
          { status: 409 },
        );
      }
      if (!previousScene.lastFrameImageUrl) {
        return NextResponse.json(
          {
            error: `Scene ${requestedSceneNumber - 1} is approved but missing a last frame image URL. Regenerate Scene ${requestedSceneNumber - 1}.`,
          },
          { status: 409 },
        );
      }
    }

    targetScenes = [targetScene];
  }

  const scenesByNumber = new Map<number, (typeof scenesWithPrompts)[number]>();
  for (const scene of scenesWithPrompts) {
    scenesByNumber.set(scene.sceneNumber, scene);
  }

  const prompts = targetScenes.flatMap((scene) => {
    const sceneNumber = Number(scene.sceneNumber);
    const safeSceneNumber = Number.isFinite(sceneNumber) ? sceneNumber : 0;
    const previousScene = scenesByNumber.get(safeSceneNumber - 1);
    const previousSceneLastFrameImageUrl = previousScene?.lastFrameImageUrl ?? null;

    return [
      {
        frameIndex: safeSceneNumber * 2,
        sceneId: scene.sceneId,
        sceneNumber: safeSceneNumber,
        promptKind: "first" as const,
        prompt: scene.firstFramePrompt,
        inputImageUrl: creatorReferenceImageUrl,
        previousSceneLastFrameImageUrl,
      },
      {
        frameIndex: safeSceneNumber * 2 + 1,
        sceneId: scene.sceneId,
        sceneNumber: safeSceneNumber,
        promptKind: "last" as const,
        prompt: scene.lastFramePrompt,
        inputImageUrl: creatorReferenceImageUrl,
        previousSceneLastFrameImageUrl,
      },
    ];
  });

  if (targetScenes.length > 0) {
    const sceneNumbersToReset = targetScenes
      .map((scene) => scene.sceneNumber)
      .filter((sceneNumber): sceneNumber is number => Number.isInteger(sceneNumber) && sceneNumber > 0);
    if (sceneNumbersToReset.length > 0) {
      try {
        await prisma.$executeRaw`
          UPDATE "storyboard_scene"
          SET "approved" = false,
              "updatedAt" = NOW()
          WHERE "storyboardId" = ${storyboard.id}
            AND "sceneNumber" IN (${Prisma.join(sceneNumbersToReset)})
        `;
      } catch {
        // Backward compatibility for environments before approval migration is applied.
      }
    }
  }

  const runNonceFromBody = asString(body.runNonce);
  const runNonce = runNonceFromBody ||
    (requestedSceneNumber !== null ? `scene-${requestedSceneNumber}-${Date.now()}` : "");

  const forwardedBody = {
    projectId,
    productId,
    ...(runId ? { runId } : {}),
    storyboardId: storyboard.id,
    prompts,
    force: body.force === true,
    providerId: body.providerId ? asString(body.providerId) : undefined,
    runNonce: runNonce || undefined,
  };

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("content-type", "application/json");
  forwardedHeaders.delete("content-length");

  const forwardedReq = new Request(new URL(`${req.nextUrl.pathname}/start`, req.url), {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify(forwardedBody),
  });

  const startResponse = await startVideoImagesStartPost(forwardedReq);
  const startData = await startResponse.json().catch(() => ({}));
  return NextResponse.json(
    {
      ...startData,
      ...(requestedSceneNumber !== null ? { sceneNumber: requestedSceneNumber } : {}),
    },
    { status: startResponse.status },
  );
}
