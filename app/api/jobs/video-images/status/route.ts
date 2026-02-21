import { cfg } from "@/lib/config";
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
        const safePolledRaw = (polled.raw && typeof polled.raw === "object") ? polled.raw : { value: polled.raw };
        const sceneRows = await prisma.storyboardScene.findMany({
          where: { storyboardId },
          select: {
            id: true,
            sceneNumber: true,
            rawJson: true,
          },
        });
        const sceneById = new Map<string, (typeof sceneRows)[number]>();
        const sceneByNumber = new Map<number, (typeof sceneRows)[number]>();
        for (const row of sceneRows) {
          sceneById.set(String(row.id), row);
          sceneByNumber.set(Number(row.sceneNumber), row);
        }

        const sceneImages = new Map<
          string,
          {
            sceneId: string | null;
            sceneNumber: number;
            firstFrameUrl: string | null;
            lastFrameUrl: string | null;
            images: typeof polled.images;
          }
        >();
        for (const image of polled.images) {
          const sceneId = String((image as any).sceneId ?? "").trim() || null;
          const sceneNumber = Number.isFinite(Number(image.sceneNumber))
            ? Number(image.sceneNumber)
            : Number(image.frameIndex);
          if (!sceneId && !Number.isFinite(sceneNumber)) continue;
          const sceneKey = sceneId ? `id:${sceneId}` : `sceneNumber:${sceneNumber}`;
          const entry = sceneImages.get(sceneKey) ?? {
            sceneId,
            sceneNumber,
            firstFrameUrl: null,
            lastFrameUrl: null,
            images: [],
          };
          entry.images.push(image);
          if (image.promptKind === "last") {
            entry.lastFrameUrl = image.url;
          } else {
            entry.firstFrameUrl = image.url;
          }
          sceneImages.set(sceneKey, entry);
        }

        const updates = Array.from(sceneImages.values()).flatMap((generated) => {
          const row = generated.sceneId
            ? sceneById.get(generated.sceneId) ?? sceneByNumber.get(generated.sceneNumber)
            : sceneByNumber.get(generated.sceneNumber);
          if (!row) return [];

          const safePrev = row.rawJson && typeof row.rawJson === "object" ? row.rawJson : {};
          const sortedImages = [...generated.images].sort((a, b) => {
            const aKindRank = a.promptKind === "last" ? 1 : 0;
            const bKindRank = b.promptKind === "last" ? 1 : 0;
            if (aKindRank !== bKindRank) return aKindRank - bKindRank;
            return a.frameIndex - b.frameIndex;
          });
          const firstFrameUrl = generated.firstFrameUrl ?? null;
          const lastFrameUrl = generated.lastFrameUrl ?? generated.firstFrameUrl ?? null;

          return [
            prisma.storyboardScene.update({
              where: { id: row.id },
              data: {
                firstFrameUrl,
                lastFrameUrl,
                rawJson: {
                  ...safePrev,
                  polled: safePolledRaw,
                  images: sortedImages,
                  firstFrameImageUrl: firstFrameUrl,
                  lastFrameImageUrl: lastFrameUrl,
                } as any,
                status: "completed" as any,
              } as any,
            }),
          ];
        });

        if (updates.length > 0) {
          await prisma.$transaction(updates);
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
    const isDev = cfg.raw("NODE_ENV") !== "production";
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
