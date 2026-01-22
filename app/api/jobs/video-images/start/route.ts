import { cfg } from "@/lib/config";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startMultiFrameVideoImages } from "@/lib/videoImageOrchestrator";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { checkRateLimit } from "@/lib/rateLimiter";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function mustSpendConfirm(req: Request) {
  const requireConfirm = (cfg.raw("KIE_REQUIRE_SPEND_CONFIRMATION") ?? "1") === "1";
  if (!requireConfirm) return;

  // In production you may choose to disable this via env.
  const headerName = (cfg.raw("KIE_SPEND_CONFIRM_HEADER") ?? "x-kie-spend-confirm").toLowerCase();
  const expected = cfg.raw("KIE_SPEND_CONFIRM_VALUE") ?? "1";
  const got = req.headers.get(headerName);
  if (got !== expected) {
    throw new Error(
      `Spend confirmation required. Set header ${headerName}: ${expected} (or disable KIE_REQUIRE_SPEND_CONFIRMATION).`
    );
  }
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let reservation: { periodKey: string; metric: string; amount: number } | null = null;
  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";
  let jobId: string | null = null;

  try {
    planId = await assertMinPlan(userId, "GROWTH");
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

  try {
    // Step 2 guard: block paid calls unless explicitly confirmed
    mustSpendConfirm(req);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const projectId = String(body?.projectId || "");
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const storyboardId = String(body?.storyboardId || "");
    if (!storyboardId) {
      return NextResponse.json({ error: "Missing storyboardId" }, { status: 400 });
    }

    const prompts = Array.isArray(body?.prompts) ? body.prompts : [];
    if (!prompts.length) {
      return NextResponse.json({ error: "Missing prompts[]" }, { status: 400 });
    }

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const storyboard = await prisma.storyboard.findFirst({
      where: { id: storyboardId, projectId },
      select: { id: true },
    });
    if (!storyboard) {
      return NextResponse.json({ error: "Storyboard or project not found" }, { status: 404 });
    }

    if (cfg.raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const runNonce = body?.runNonce ? String(body.runNonce) : undefined;

    const frameIndexes = prompts
      .map((p: any) => Number(p?.frameIndex))
      .filter((n: number) => Number.isFinite(n));
    const uniqueFrames = new Set(frameIndexes);
    const reservationAmount = uniqueFrames.size > 1 ? 2 : 1;

    try {
      reservation = await reserveQuota(userId, planId, "imageJobs", reservationAmount);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: "Quota exceeded", metric: "imageJobs", limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

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
      where: { type: "VIDEO_IMAGE_GENERATION", projectId, idempotencyKey: result.idempotencyKey },
      orderBy: { createdAt: "desc" },
    });

    const payload = {
      projectId,
      storyboardId,
      providerId: result.providerId,
      taskGroupId: result.taskGroupId,
      force: !!body?.force,
      tasks: result.tasks, // ONLY first+last tasks
      runNonce: runNonce ?? null,
      quotaReservation: reservation
        ? { periodKey: reservation.periodKey, metric: "imageJobs", amount: reservation.amount }
        : null,
    };

    if (existing) {
      jobId = existing.id;
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
      const job = await prisma.job.create({
        data: {
          type: "VIDEO_IMAGE_GENERATION",
          status: "RUNNING" as any,
          projectId,
          userId,
          idempotencyKey: result.idempotencyKey,
          payload: payload as any,
          resultSummary: null,
          error: null,
        } as any,
      });
      jobId = job.id;
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
    if (reservation && !jobId) {
      try {
        await rollbackQuota(userId, reservation.periodKey, "imageJobs", reservation.amount);
      } catch (rollbackErr) {
        console.error("Quota rollback failed", rollbackErr);
      }
    }
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
