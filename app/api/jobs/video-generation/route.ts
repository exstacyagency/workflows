// app/api/jobs/video-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../lib/prisma";
import { getSessionUserId } from "../../../../lib/getSessionUserId";
import { requireProjectOwner } from "../../../../lib/requireProjectOwner";
import { assertMinPlan, UpgradeRequiredError } from "../../../../lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "../../../../lib/billing/usage";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { getRequestId } from "../../../../lib/observability";
import { checkRateLimit } from "../../../../lib/rateLimiter";
import { assertRuntimeMode } from "@/src/runtime/assertMode";

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().min(1),
  storyboardId: z.string().min(1),
  productId: z.string().trim().min(1).max(200).optional(),
  runId: z.string().trim().min(1).max(200).optional(),
  sceneNumber: z.number().int().positive().optional(),
  forceNew: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  assertRuntimeMode();

  const requestId = getRequestId(req) ?? (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`);
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let userId: string | null = null;
  // Track rollback primitives explicitly (avoids TS narrowing issues)
  let reservationPeriodKey: string | null = null;
  let reservationAmount = 0;
  let reservationUserId: string | null = null;
  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";
  let jobId: string | null = null;
  const rollbackReservation = async () => {
    if (reservationPeriodKey && reservationUserId && reservationAmount > 0) {
      try {
        await rollbackQuota(
          reservationUserId,
          reservationPeriodKey,
          "videoJobs",
          reservationAmount,
        );
      } catch {}
      reservationPeriodKey = null;
      reservationAmount = 0;
      reservationUserId = null;
    }
  };
  try {
    userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const { projectId, scriptId, storyboardId, forceNew } = parsed.data;
    const requestedProductId = parsed.data.productId ? String(parsed.data.productId).trim() : "";
    const requestedRunId = parsed.data.runId ? String(parsed.data.runId).trim() : "";
    const requestedSceneNumber = parsed.data.sceneNumber ?? null;
    let effectiveRunId: string | null = null;
    let effectiveProductId: string | null = null;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (requestedRunId) {
      const run = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
        select: { id: true, projectId: true },
      });
      if (!run || run.projectId !== projectId) {
        return NextResponse.json({ error: "runId not found for this project" }, { status: 400 });
      }
      effectiveRunId = run.id;
    }

    if (requestedProductId) {
      const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "product"
        WHERE "id" = ${requestedProductId}
          AND "project_id" = ${projectId}
        LIMIT 1
      `;
      if (!productRows[0]?.id) {
        return NextResponse.json({ error: "productId not found for this project" }, { status: 400 });
      }
      effectiveProductId = requestedProductId;
    }

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

    if (!securitySweep) {
      try {
        const reserved: any = await reserveQuota(userId, planId, "videoJobs", 1);
        reservationPeriodKey = String(reserved?.periodKey || "");
        reservationAmount = Number(reserved?.amount ?? 1);
        reservationUserId = userId;
        if (!reservationPeriodKey) {
          throw new Error("reserveQuota returned no periodKey");
        }
      } catch (err: any) {
        if (err instanceof QuotaExceededError) {
          return NextResponse.json(
            { error: "Quota exceeded", metric: "videoJobs", limit: err.limit, used: err.used },
            { status: 429 },
          );
        }
        throw err;
      }
    }

    if (cfg.raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        await rollbackReservation();
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, projectId: true },
    });
    if (!script || script.projectId !== projectId) {
      await rollbackReservation();
      return NextResponse.json({ error: "Script or project not found" }, { status: 404 });
    }

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      select: {
        id: true,
        projectId: true,
        scenes: { select: { id: true, rawJson: true } },
      },
    });
    if (!storyboard || storyboard.projectId !== projectId) {
      await rollbackReservation();
      return NextResponse.json({ error: "Storyboard or project not found" }, { status: 404 });
    }

    // SECURITY_SWEEP: do NOT require frames to exist. Return deterministic success.
    // Still respects plan + ownership + quota.
    if (securitySweep) {
      const forceNonce = forceNew
        ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
        : null;
      const idempotencyKey = JSON.stringify([
        projectId,
        "VIDEO_GENERATION",
        storyboardId,
        scriptId,
        effectiveProductId ?? "no_product",
        effectiveRunId ?? "no_run",
        requestedSceneNumber !== null ? `scene:${requestedSceneNumber}` : "all",
        ...(forceNonce ? [`force:${forceNonce}`] : []),
      ]);

      // If an existing job exists, reuse it but still mark skipped for sweep-mode determinism.
      const existingAny = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.VIDEO_GENERATION,
          idempotencyKey,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, runId: true },
      });
      if (existingAny?.id) {
        return NextResponse.json(
          {
            ok: true,
            jobId: existingAny.id,
            runId: existingAny.runId ?? effectiveRunId,
            reused: true,
            started: false,
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          { status: 200 },
        );
      }

      // Reserve quota even in sweep mode (no billing bypass).
      try {
        const reserved: any = await reserveQuota(userId, planId, "videoJobs", 1);
        reservationPeriodKey = String(reserved?.periodKey || "");
        reservationAmount = Number(reserved?.amount ?? 1);
        reservationUserId = userId;
        if (!reservationPeriodKey) throw new Error("reserveQuota returned no periodKey");
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
          type: JobType.VIDEO_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          payload: {
            projectId,
            storyboardId,
            scriptId,
            ...(requestedSceneNumber !== null ? { sceneNumber: requestedSceneNumber } : {}),
            ...(effectiveProductId ? { productId: effectiveProductId } : {}),
            idempotencyKey,
            ...(effectiveRunId ? { runId: effectiveRunId } : {}),
            quotaReservation: {
              periodKey: reservationPeriodKey,
              metric: "videoJobs",
              amount: reservationAmount || 1,
            },
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
      });
      jobId = job.id;

      return NextResponse.json(
        {
          ok: true,
          jobId,
          runId: effectiveRunId,
          stage: "SECURITY_SWEEP",
          reused: false,
          started: false,
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
        { status: 200 },
      );
    }

    if (!storyboard.scenes.length) {
      await rollbackReservation();
      return NextResponse.json(
        { error: "Storyboard has no scenes" },
        { status: 409 },
      );
    }

    const forceNonce = forceNew
      ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
      : null;
    const idempotencyKey = JSON.stringify([
      projectId,
      "VIDEO_GENERATION",
      storyboardId,
      scriptId,
      effectiveProductId ?? "no_product",
      effectiveRunId ?? "no_run",
      requestedSceneNumber !== null ? `scene:${requestedSceneNumber}` : "all",
      ...(forceNonce ? [`force:${forceNonce}`] : []),
    ]);

    const existing = forceNew
      ? null
      : await prisma.job.findFirst({
          where: {
            projectId,
            type: JobType.VIDEO_GENERATION,
            idempotencyKey,
            status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, runId: true },
        });

    if (existing?.id) {
      await rollbackReservation();
      return NextResponse.json(
        { ok: true, jobId: existing.id, runId: existing.runId ?? effectiveRunId, reused: true },
        { status: 200 },
      );
    }

    try {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.VIDEO_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          payload: {
            projectId,
            storyboardId,
            scriptId,
            ...(requestedSceneNumber !== null ? { sceneNumber: requestedSceneNumber } : {}),
            ...(effectiveProductId ? { productId: effectiveProductId } : {}),
            ...(forceNew ? { forceNew: true } : {}),
            idempotencyKey,
            ...(effectiveRunId ? { runId: effectiveRunId } : {}),
            quotaReservation: {
              periodKey: reservationPeriodKey,
              metric: "videoJobs",
              amount: reservationAmount || 1,
            },
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
        select: { id: true, runId: true },
      });
      if (raced?.id) {
        if (reservationPeriodKey && reservationUserId && reservationAmount > 0) {
          await rollbackQuota(
            reservationUserId,
            reservationPeriodKey,
            "videoJobs",
            reservationAmount,
          );
          reservationPeriodKey = null;
          reservationAmount = 0;
        }
        return NextResponse.json(
          { ok: true, jobId: raced.id, runId: raced.runId ?? effectiveRunId, reused: true },
          { status: 200 },
        );
      }
      if (reservationPeriodKey && reservationUserId && reservationAmount > 0) {
        await rollbackQuota(
          reservationUserId,
          reservationPeriodKey,
          "videoJobs",
          reservationAmount,
        );
        reservationPeriodKey = null;
        reservationAmount = 0;
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
      { ok: true, jobId, runId: effectiveRunId, stage: "VIDEO_PROMPTS_ENQUEUED", reused: false },
      { status: 200 },
    );
  } catch (err: any) {
    console.error(err);
    // Best-effort rollback if we reserved quota and then failed later
    try {
      if (reservationPeriodKey && reservationUserId && reservationAmount > 0) {
        await rollbackQuota(
          reservationUserId,
          reservationPeriodKey,
          "videoJobs",
          reservationAmount,
        );
      }
    } catch {}
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
