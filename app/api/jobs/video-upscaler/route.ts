// app/api/jobs/video-upscaler/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { runVideoUpscalerBatch } from '../../../../lib/videoUpscalerService';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import prisma from '../../../../lib/prisma';
import { StoryboardJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { updateJobStatus } from "../../../../lib/jobs/updateJobStatus";

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
    const parsed = await parseJson(req, StoryboardJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { storyboardId } = parsed.data;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      select: { id: true, projectId: true },
    });

    // Storyboard model already has projectId; do not require storyboard.script.project
    if (!storyboard?.projectId) {
      return NextResponse.json(
        { error: 'Storyboard or project not found' },
        { status: 404 },
      );
    }

    projectId = storyboard.projectId;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Plan check AFTER ownership to avoid leaking project existence via 402.
    try {
      planId = await assertMinPlan(userId, 'SCALE');
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

    // SECURITY_SWEEP should not be blocked by concurrency.
    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json({ error: concurrency.reason }, { status: 429 });
      }
    }

    // SECURITY_SWEEP should not require vendor keys.
    if (!securitySweep && !cfg.raw("FAL_API_KEY")) {
      return NextResponse.json(
        { error: 'FAL is not configured' },
        { status: 500 },
      );
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
      JobType.VIDEO_UPSCALER,
      storyboardId,
    ]);
    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JobType.VIDEO_UPSCALER,
      idempotencyKey,
    });
    if (existing) {
      if (securitySweep) {
        return NextResponse.json(
          { jobId: existing.id, reused: true, started: false, skipped: true, reason: "SECURITY_SWEEP" },
          { status: 200 },
        );
      }
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
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

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.VIDEO_UPSCALER,
        status: JobStatus.PENDING,
        idempotencyKey,
        payload: { storyboardId, idempotencyKey },
        resultSummary: securitySweep ? "Skipped: SECURITY_SWEEP" : undefined,
        error: Prisma.JsonNull,
      },
    });
    jobId = job.id;

    // SECURITY_SWEEP: after plan+quota+job record, do not call vendor.
    if (securitySweep) {
      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.create',
        ip,
        metadata: { type: 'video-upscaler', skipped: true, reason: 'SECURITY_SWEEP' },
      });
      return NextResponse.json(
        { ok: true, jobId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
      );
    }

    await updateJobStatus(job.id, JobStatus.RUNNING);

    const result = await runVideoUpscalerBatch();

    await updateJobStatus(job.id, JobStatus.COMPLETED);
    await prisma.job.update({
      where: { id: job.id },
      data: { resultSummary: `Video upscaler processed ${result.count} scripts` },
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-upscaler',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (reservation) {
      await rollbackQuota(userId, reservation.periodKey, 'videoJobs', 1);
    }
    if (jobId) {
      await updateJobStatus(jobId, JobStatus.FAILED);
      await prisma.job.update({
        where: { id: jobId },
        data: { error: err?.message ?? 'Video upscaler failed' },
      });
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-upscaler',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Video upscaler failed' },
      { status: 500 },
    );
  }
}
