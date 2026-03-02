import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { checkRateLimit } from "@/lib/rateLimiter";
import { enforceUserConcurrency, findIdempotentJob } from "@/lib/jobGuards";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "@/lib/billing/usage";

const BodySchema = z.object({
  projectId: z.string().min(1),
  storyboardId: z.string().min(1),
  scriptId: z.string().min(1),
  runId: z.string().trim().min(1).max(200).optional(),
  mergedVideoUrl: z.string().trim().url().optional(),
  forceNew: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let reservation: { periodKey: string; amount: number } | null = null;
  try {
    const body = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const { projectId, storyboardId, scriptId, forceNew } = parsed.data;
    const requestedRunId = String(parsed.data.runId ?? "").trim();
    let effectiveRunId: string | null = null;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (requestedRunId) {
      const existingRun = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
        select: { id: true, projectId: true },
      });
      if (!existingRun || existingRun.projectId !== projectId) {
        return NextResponse.json({ error: "runId not found for this project" }, { status: 400 });
      }
      effectiveRunId = existingRun.id;
    }

    const [script, storyboard] = await Promise.all([
      prisma.script.findUnique({
        where: { id: scriptId },
        select: { id: true, projectId: true, mergedVideoUrl: true },
      }),
      prisma.storyboard.findUnique({
        where: { id: storyboardId },
        select: { id: true, projectId: true, scriptId: true },
      }),
    ]);

    if (!script || script.projectId !== projectId) {
      return NextResponse.json({ error: "Script or project not found" }, { status: 404 });
    }
    if (!storyboard || storyboard.projectId !== projectId) {
      return NextResponse.json({ error: "Storyboard or project not found" }, { status: 404 });
    }
    if (storyboard.scriptId !== scriptId) {
      return NextResponse.json({ error: "scriptId does not belong to storyboardId" }, { status: 400 });
    }

    const effectiveMergedVideoUrl =
      String(parsed.data.mergedVideoUrl ?? "").trim() || String(script.mergedVideoUrl ?? "").trim();
    if (!effectiveMergedVideoUrl) {
      return NextResponse.json(
        { error: "No merged video found. Complete Edit Video merge before swapping audio." },
        { status: 409 },
      );
    }

    try {
      await assertMinPlan(userId, "SCALE");
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

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json({ error: concurrency.reason }, { status: 429 });
    }

    if (!cfg.raw("ELEVENLABS_API_KEY")) {
      return NextResponse.json({ error: "ElevenLabs is not configured" }, { status: 500 });
    }

    const elevenLabsVoiceId: string | null = null;

    if (cfg.raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const forceNonce = forceNew
      ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
      : null;
    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.VIDEO_UPSCALER,
      storyboardId,
      scriptId,
      effectiveRunId ?? "no_run",
      ...(forceNonce ? [`force:${forceNonce}`] : []),
    ]);

    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JobType.VIDEO_UPSCALER,
      idempotencyKey,
    });
    if (existing) {
      return NextResponse.json(
        { jobId: existing.id, runId: existing.runId ?? effectiveRunId, reused: true },
        { status: 200 },
      );
    }

    try {
      const quotaReservation = await reserveQuota(userId, "SCALE", "videoJobs", 1);
      reservation = { periodKey: quotaReservation.periodKey, amount: quotaReservation.amount };
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: "Quota exceeded", metric: "videoJobs", limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.VIDEO_UPSCALER,
        status: JobStatus.PENDING,
        idempotencyKey,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        payload: {
          projectId,
          storyboardId,
          scriptId,
          mergedVideoUrl: effectiveMergedVideoUrl,
          elevenLabsVoiceId,
          jobLabel: "Swap Audio",
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          quotaReservation: reservation
            ? {
                periodKey: reservation.periodKey,
                metric: "videoJobs",
                amount: reservation.amount || 1,
              }
            : undefined,
        },
        error: Prisma.JsonNull,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        runId: effectiveRunId,
        reused: false,
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (reservation) {
      await rollbackQuota(userId, reservation.periodKey, "videoJobs", reservation.amount || 1).catch(() => {});
    }
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "Audio swap failed" }, { status: 500 });
  }
}
