import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pollMultiFrameVideoImages } from "@/lib/videoImageOrchestrator";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { checkRateLimit } from "@/lib/rateLimiter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const rate = await checkRateLimit(`deadletter:video-images:status:${userId}`, {
      limit: 30,
      windowMs: 60 * 1000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: rate.reason ?? "Rate limit exceeded" },
        { status: 429 },
      );
    }

    const body = await req.json();
    const idempotencyKey = body?.idempotencyKey ? String(body.idempotencyKey) : null;
    const taskGroupId = body?.taskGroupId ? String(body.taskGroupId) : null;
    const providerId = body?.providerId;
    const storyboardId = body?.storyboardId ? String(body.storyboardId) : null;

    // We poll by job (group) rather than a single taskId, because Nano Banana is single-image per task.
    const job = await prisma.job.findFirst({
      where: {
        type: "VIDEO_IMAGE_GENERATION",
        project: { userId },
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
        const safePrev = (payload?.rawJson && typeof payload.rawJson === "object") ? payload.rawJson : {};
        const safePolledRaw = (polled.raw && typeof polled.raw === "object") ? polled.raw : { value: polled.raw };

        const updated = await prisma.storyboardScene.updateMany({
          where: { storyboardId },
          data: {
            firstFrameUrl: firstUrl,
            lastFrameUrl: lastUrl,
            rawJson: { ...safePrev, polled: safePolledRaw, images: sorted } as any,
            status: "completed" as any,
          } as any,
        });

        // If no scene rows exist yet, create a minimal one (MVP behavior).
        if (updated.count === 0) {
          await prisma.storyboardScene.create({
            data: {
              storyboardId,
              sceneNumber: 1,
              durationSec: 8,
              aspectRatio: "9:16",
              sceneFull: "true",
              rawJson: { polled: safePolledRaw, images: sorted } as any,
              status: "completed" as any,
              firstFrameUrl: firstUrl,
              lastFrameUrl: lastUrl,
            } as any,
          });
        }
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
    const msg = String(e?.message || e || "Unknown error");
    const isDev = process.env.NODE_ENV !== "production";
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        ...(isDev ? { stack: String(e?.stack || "") } : {}),
      },
      { status: 500 }
    );
  }
}
