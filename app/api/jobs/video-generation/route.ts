// app/api/jobs/video-generation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../lib/prisma";
import { getSessionUserId } from "../../../../lib/getSessionUserId";
import { requireProjectOwner } from "../../../../lib/requireProjectOwner";
import { assertMinPlan, UpgradeRequiredError } from "../../../../lib/billing/requirePlan";
import { JobStatus, JobType } from "@prisma/client";
import { getRequestId } from "../../../../lib/observability";

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().min(1),
  storyboardId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req) ?? (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`);
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await assertMinPlan(userId, "GROWTH");
    } catch (err: any) {
      if (err instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { error: "Upgrade required", requiredPlan: err.requiredPlan },
          { status: 402 },
        );
      }
      console.error(err);
      return NextResponse.json({ error: "Billing check failed" }, { status: 500 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const { projectId, scriptId, storyboardId } = parsed.data;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, projectId: true },
    });
    if (!script || script.projectId !== projectId) {
      return NextResponse.json({ error: "Script or project not found" }, { status: 404 });
    }

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      select: {
        id: true,
        projectId: true,
        scenes: { select: { id: true, firstFrameUrl: true, lastFrameUrl: true } },
      },
    });
    if (!storyboard || storyboard.projectId !== projectId) {
      return NextResponse.json({ error: "Storyboard or project not found" }, { status: 404 });
    }

    if (!storyboard.scenes.length) {
      return NextResponse.json(
        { error: "Frames not ready", missing: [] },
        { status: 409 },
      );
    }
    const missing = storyboard.scenes
      .map((scene) => {
        const missingFields: string[] = [];
        if (!scene.firstFrameUrl || String(scene.firstFrameUrl).trim().length === 0) {
          missingFields.push("firstFrameUrl");
        }
        if (!scene.lastFrameUrl || String(scene.lastFrameUrl).trim().length === 0) {
          missingFields.push("lastFrameUrl");
        }
        return missingFields.length > 0
          ? { sceneId: scene.id, missing: missingFields }
          : null;
      })
      .filter((entry): entry is { sceneId: string; missing: string[] } => !!entry);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Frames not ready", missing },
        { status: 409 },
      );
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      "VIDEO_GENERATION",
      storyboardId,
      scriptId,
    ]);

    const existing = await prisma.job.findFirst({
      where: {
        projectId,
        type: JobType.VIDEO_GENERATION,
        idempotencyKey,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (existing?.id) {
      return NextResponse.json({ ok: true, jobId: existing.id, reused: true }, { status: 200 });
    }

    let jobId: string | null = null;
    try {
      const job = await prisma.job.create({
        data: {
          projectId,
          type: JobType.VIDEO_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload: {
            projectId,
            storyboardId,
            scriptId,
            idempotencyKey,
          },
        },
      });
      jobId = job.id;
    } catch (err: any) {
      const code = String(err?.code ?? "");
      const message = String(err?.message ?? "");
      const isUnique = code === "P2002" || message.toLowerCase().includes("unique constraint");
      if (!isUnique) throw err;

      const raced = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.VIDEO_GENERATION,
          idempotencyKey,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (raced?.id) {
        return NextResponse.json({ ok: true, jobId: raced.id, reused: true }, { status: 200 });
      }
      return NextResponse.json(
        {
          error: "Video generation failed",
          detail: "Unique constraint but job not found",
          requestId,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, jobId, stage: "VIDEO_PROMPTS_ENQUEUED", reused: false },
      { status: 200 },
    );
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      {
        error: "Video generation failed",
        detail: String(err?.message ?? err),
        requestId,
      },
      { status: 500 },
    );
  }
}
