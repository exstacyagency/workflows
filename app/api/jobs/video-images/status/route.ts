import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pollMultiFrameVideoImages } from "@/lib/videoImageOrchestrator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const idempotencyKey = body?.idempotencyKey ? String(body.idempotencyKey) : null;
    const taskGroupId = body?.taskGroupId ? String(body.taskGroupId) : null;
    const providerId = body?.providerId;
    const storyboardId = body?.storyboardId ? String(body.storyboardId) : null;

    // We poll by job (group) rather than a single taskId, because Nano Banana is single-image per task.
    const job = await prisma.job.findFirst({
      where: {
        type: "VIDEO_IMAGE_GENERATION",
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(taskGroupId ? { payload: { path: ["taskGroupId"], equals: taskGroupId } as any } : {}),
        ...(!idempotencyKey && !taskGroupId && storyboardId
          ? { payload: { path: ["storyboardId"], equals: storyboardId } as any }
          : {}),
      } as any,
      orderBy: { createdAt: "desc" },
    });

    if (!job) {
      return NextResponse.json(
        { ok: false, error: "No VIDEO_IMAGE_GENERATION job found (provide idempotencyKey or taskGroupId or storyboardId)" },
        { status: 404 }
      );
    }

    const payload = job.payload as any;
    const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
    if (!tasks.length) {
      return NextResponse.json({ ok: false, error: "Job payload has no tasks[]" }, { status: 500 });
    }

    const polled = await pollMultiFrameVideoImages({
      providerId: providerId ?? payload.providerId,
      tasks,
    });

    // Persist updated per-frame task states/urls
    const updatedPayload = {
      ...payload,
      providerId: polled.providerId,
      tasks: polled.tasks,
      result: { ok: true, status: polled.status, images: polled.images },
    };

    if (polled.status === "FAILED") {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED" as any,
          error: polled.errorMessage ?? "One or more frames failed",
          payload: updatedPayload as any,
          resultSummary: "Video image generation failed",
        } as any,
      });
    } else if (polled.status === "SUCCEEDED") {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED" as any,
          error: null,
          payload: updatedPayload as any,
          resultSummary: `Video frames saved: ${polled.images.length}`,
        } as any,
      });

      // Persist into StoryboardScene (summary)
      const storyboardId = payload?.storyboardId;
      if (storyboardId && polled.images.length > 0) {
        const sorted = [...polled.images].sort((a, b) => a.frameIndex - b.frameIndex);
        const firstUrl = sorted[0].url;
        const lastUrl = sorted.length > 1 ? sorted[sorted.length - 1].url : sorted[0].url;
        await prisma.storyboardScene.updateMany({
          where: { storyboardId },
          data: {
            firstFrameUrl: firstUrl,
            lastFrameUrl: lastUrl,
            rawJson: { ...(payload?.rawJson ?? {}), ...polled.raw, images: sorted } as any,
            status: "completed" as any,
          } as any,
        });
      }
    } else {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "RUNNING" as any,
          error: null,
          payload: updatedPayload as any,
          resultSummary: `Video frames in progress: ${polled.images.length}/${polled.tasks.length}`,
        } as any,
      });
    }

    return NextResponse.json({
      ok: true,
      status: polled.status,
      images: polled.images,
      errorMessage: polled.errorMessage,
      taskGroupId: payload?.taskGroupId,
      idempotencyKey: job.idempotencyKey,
      raw: polled.raw,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
