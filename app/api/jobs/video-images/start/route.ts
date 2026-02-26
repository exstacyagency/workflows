import { NextResponse } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner404 } from "@/lib/auth/requireProjectOwner404";
import {
  startMultiFrameVideoImages,
  type FramePrompt,
  type FrameTask,
  type StartMultiFrameResult,
} from "@/lib/videoImageOrchestrator";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPrompt(value: unknown): FramePrompt | null {
  const raw = asObject(value) ?? {};
  const prompt = asString(raw.prompt);
  if (!prompt) return null;
  const frameIndex = Number(raw.frameIndex);
  if (!Number.isFinite(frameIndex)) return null;
  const sceneNumber = Number(raw.sceneNumber);
  return {
    frameIndex: Math.trunc(frameIndex),
    sceneId: asString(raw.sceneId) || null,
    sceneNumber: Number.isFinite(sceneNumber) ? Math.trunc(sceneNumber) : undefined,
    frameType: raw.frameType === "last" ? "last" : "first",
    promptKind: raw.promptKind === "last" ? "last" : "first",
    prompt,
    referenceImageUrls: Array.isArray(raw.referenceImageUrls)
      ? raw.referenceImageUrls
          .map((entry) => asString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    inputImageUrl: asString(raw.inputImageUrl) || null,
    previousSceneLastFrameImageUrl: asString(raw.previousSceneLastFrameImageUrl) || null,
  };
}

export async function POST(req: Request) {
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

  const projectId = asString(body.projectId);
  const productId = asString(body.productId);
  const storyboardId = asString(body.storyboardId);
  const runId = asString(body.runId) || null;
  const runNonce = asString(body.runNonce) || undefined;
  const force = body.force === true;
  const providerId = asString(body.providerId) || undefined;
  const promptsRaw = Array.isArray(body.prompts) ? body.prompts : [];
  const prompts = promptsRaw
    .map((entry) => asPrompt(entry))
    .filter((entry): entry is FramePrompt => Boolean(entry));

  if (!projectId || !productId || !storyboardId) {
    return NextResponse.json(
      { error: "Missing required fields: projectId, productId, storyboardId" },
      { status: 400 },
    );
  }
  if (!prompts.length) {
    return NextResponse.json({ error: "prompts[] is required" }, { status: 400 });
  }

  const deny = await requireProjectOwner404(projectId);
  if (deny) return deny;

  const existingStoryboard = await prisma.storyboard.findFirst({
    where: { id: storyboardId, projectId },
    select: { id: true },
  });
  if (!existingStoryboard) {
    return NextResponse.json({ error: "Storyboard not found for this project" }, { status: 404 });
  }

  let started: StartMultiFrameResult;
  try {
    started = await startMultiFrameVideoImages({
      storyboardId,
      providerId: providerId as any,
      force,
      runNonce,
      prompts,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e ?? "Failed to start video image generation") },
      { status: 502 },
    );
  }

  const payload = {
    projectId,
    productId,
    storyboardId,
    ...(runId ? { runId } : {}),
    providerId: started.providerId,
    taskGroupId: started.taskGroupId,
    tasks: started.tasks,
    prompts,
    idempotencyKey: started.idempotencyKey,
  };

  const resultForResponse = {
    ok: true,
    queued: true,
    providerId: started.providerId,
    taskGroupId: started.taskGroupId,
    idempotencyKey: started.idempotencyKey,
    taskCount: started.tasks.length,
  };

  try {
    const existing = await prisma.job.findFirst({
      where: {
        userId,
        projectId,
        type: JobType.VIDEO_IMAGE_GENERATION,
        idempotencyKey: started.idempotencyKey,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, runId: true, payload: true, status: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          ...resultForResponse,
          reused: true,
          jobId: existing.id,
          runId: existing.runId ?? runId,
          status: existing.status,
        },
        { status: 200 },
      );
    }

    const created = await prisma.job.create({
      data: {
        projectId,
        userId,
        runId,
        type: JobType.VIDEO_IMAGE_GENERATION,
        status: JobStatus.PENDING,
        idempotencyKey: started.idempotencyKey,
        payload: payload as any,
      },
      select: { id: true, runId: true, status: true },
    });

    return NextResponse.json(
      {
        ...resultForResponse,
        reused: false,
        jobId: created.id,
        runId: created.runId ?? runId,
        status: created.status,
      },
      { status: 200 },
    );
  } catch (e: any) {
    const code = String(e?.code ?? "");
    if (code === "P2002") {
      const existing = await prisma.job.findFirst({
        where: {
          userId,
          projectId,
          type: JobType.VIDEO_IMAGE_GENERATION,
          idempotencyKey: started.idempotencyKey,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, runId: true, status: true },
      });
      if (existing) {
        return NextResponse.json(
          {
            ...resultForResponse,
            reused: true,
            jobId: existing.id,
            runId: existing.runId ?? runId,
            status: existing.status,
          },
          { status: 200 },
        );
      }
    }
    return NextResponse.json(
      { error: String(e?.message ?? e ?? "Failed to persist video image generation job") },
      { status: 500 },
    );
  }
}
