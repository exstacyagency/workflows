import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startMultiFrameVideoImages } from "@/lib/videoImageOrchestrator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function mustSpendConfirm(req: Request) {
  const requireConfirm = (process.env.KIE_REQUIRE_SPEND_CONFIRMATION ?? "1") === "1";
  if (!requireConfirm) return;

  // In production you may choose to disable this via env.
  const headerName = (process.env.KIE_SPEND_CONFIRM_HEADER ?? "x-kie-spend-confirm").toLowerCase();
  const expected = process.env.KIE_SPEND_CONFIRM_VALUE ?? "1";
  const got = req.headers.get(headerName);
  if (got !== expected) {
    throw new Error(
      `Spend confirmation required. Set header ${headerName}: ${expected} (or disable KIE_REQUIRE_SPEND_CONFIRMATION).`
    );
  }
}

export async function POST(req: Request) {
  try {
    // Step 2 guard: block paid calls unless explicitly confirmed
    mustSpendConfirm(req);

    const body = await req.json();

    const storyboardId = String(body?.storyboardId || "");
    if (!storyboardId) {
      return NextResponse.json({ error: "Missing storyboardId" }, { status: 400 });
    }

    const prompts = Array.isArray(body?.prompts) ? body.prompts : [];
    if (!prompts.length) {
      return NextResponse.json({ error: "Missing prompts[]" }, { status: 400 });
    }

    const runNonce = body?.runNonce ? String(body.runNonce) : undefined;

    // Only first+last are used. Make it explicit in the payload we persist.
    const result = await startMultiFrameVideoImages({
      storyboardId,
      force: !!body?.force,
      providerId: body?.providerId,
      runNonce,
      prompts: prompts.map((p: any) => ({
        frameIndex: Number(p.frameIndex),
        prompt: String(p.prompt || ""),
        negativePrompt: p.negativePrompt ? String(p.negativePrompt) : undefined,
        inputImageUrl: p.inputImageUrl ? String(p.inputImageUrl) : null,
        maskImageUrl: p.maskImageUrl ? String(p.maskImageUrl) : null,
        width: p.width ? Number(p.width) : undefined,
        height: p.height ? Number(p.height) : undefined,
      })),
    });

    // Persist a single group Job row + all per-frame taskIds in payload.
    const existing = await prisma.job.findFirst({
      where: { type: "VIDEO_IMAGE_GENERATION", idempotencyKey: result.idempotencyKey },
      orderBy: { createdAt: "desc" },
    });

    const payload = {
      storyboardId,
      providerId: result.providerId,
      taskGroupId: result.taskGroupId,
      force: !!body?.force,
      tasks: result.tasks, // ONLY first+last tasks
      runNonce: runNonce ?? null,
    };

    if (existing) {
      await prisma.job.update({
        where: { id: existing.id },
        data: {
          status: "RUNNING" as any,
          error: null,
          payload: payload as any,
          resultSummary: null,
        } as any,
      });
    } else {
      await prisma.job.create({
        data: {
          type: "VIDEO_IMAGE_GENERATION",
          status: "RUNNING" as any,
          projectId: String(body?.projectId || "proj_test"),
          idempotencyKey: result.idempotencyKey,
          payload: payload as any,
          resultSummary: null,
          error: null,
        } as any,
      });
    }

    // Return group identifiers so clients can poll without needing a single taskId.
    return NextResponse.json({
      ok: true,
      providerId: result.providerId,
      idempotencyKey: result.idempotencyKey,
      taskGroupId: result.taskGroupId,
      tasks: result.tasks,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
