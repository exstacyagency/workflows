// app/api/jobs/video-prompts/route.ts
import { randomUUID } from "crypto";
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body', details: 'Invalid JSON body' }, { status: 400 });
    }

    const BodySchema = z.object({
      storyboardId: z.string().min(1),
      productId: z.string().trim().min(1).max(200).optional(),
      attemptKey: z.string().trim().min(1).max(200).optional(),
      runId: z.string().trim().min(1).max(200).optional(),
    });

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const storyboardId = parsed.data.storyboardId;
    const requestedProductId = parsed.data.productId ? String(parsed.data.productId).trim() : "";
    const requestedRunId = parsed.data.runId ? String(parsed.data.runId).trim() : "";
    let effectiveProductId: string | null = null;
    let effectiveRunId: string | null = null;
    // Keep idempotency scoped to a single generation attempt.
    // If client does not supply attemptKey, generate a unique nonce per request.
    const attemptKey = parsed.data.attemptKey || `${Date.now()}-${randomUUID()}`;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      select: { id: true, projectId: true },
    });
    if (!storyboard) {
      return NextResponse.json(
        { error: 'Storyboard or project not found' },
        { status: 404 },
      );
    }
    projectId = storyboard.projectId;

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

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

    // Plan check AFTER ownership to avoid leaking project existence via 402.
    try {
      planId = await assertMinPlan(userId, 'GROWTH');
    } catch (err: any) {
      if (err instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { error: 'Upgrade required', requiredPlan: err.requiredPlan },
          { status: 402 },
        );
      }
      console.error(err);
      return NextResponse.json({ error: 'Billing check failed' }, { status: 500 });
    }

    // SECURITY_SWEEP should not be blocked by concurrency. Concurrency is for real vendor work.
    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json({ error: concurrency.reason }, { status: 429 });
      }
    }

    if (cfg.raw("NODE_ENV") === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.VIDEO_PROMPT_GENERATION,
      storyboardId,
      effectiveProductId ?? "no_product",
      effectiveRunId ?? "no_run",
      attemptKey,
    ]);
    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      idempotencyKey,
    });
    if (existing) {
      // Deterministic smoke semantics: reused jobs in SECURITY_SWEEP should still report skipped.
      if (securitySweep) {
        return NextResponse.json(
          {
            jobId: existing.id,
            runId: existing.runId ?? effectiveRunId,
            reused: true,
            started: false,
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { jobId: existing.id, runId: existing.runId ?? effectiveRunId, reused: true },
        { status: 200 },
      );
    }

    try {
      reservation = await reserveQuota(userId, planId, 'videoJobs', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'videoJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    // SECURITY_SWEEP: after plan+quota, never call external/model services. Return deterministic placeholder.
    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.VIDEO_PROMPT_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          payload: {
            storyboardId,
            ...(effectiveProductId ? { productId: effectiveProductId } : {}),
            idempotencyKey,
            ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          },
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
        select: { id: true, runId: true },
      });
      jobId = job.id;

      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.create',
        ip,
        metadata: { type: 'video-prompts', skipped: true, reason: 'SECURITY_SWEEP' },
      });

      return NextResponse.json(
        {
          jobId,
          runId: job.runId ?? effectiveRunId,
          started: false,
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
        { status: 200 }
      );
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.VIDEO_PROMPT_GENERATION,
        status: JobStatus.PENDING,
        idempotencyKey,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        payload: {
          storyboardId,
          ...(effectiveProductId ? { productId: effectiveProductId } : {}),
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        },
      },
      select: { id: true, runId: true },
    });
    jobId = job.id;
    reservation = null;

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-prompts',
      },
    });

    return NextResponse.json(
      { jobId: job.id, runId: job.runId ?? effectiveRunId, queued: true, reused: false },
      { status: 200 },
    );
  } catch (err: any) {
    console.error(err);
    if (reservation && !jobId) {
      await rollbackQuota(userId, reservation.periodKey, 'videoJobs', 1);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-prompts',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Video prompt generation failed' },
      { status: 500 },
    );
  }
}
