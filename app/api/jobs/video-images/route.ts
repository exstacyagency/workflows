// app/api/jobs/video-images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { StoryboardJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { startVideoImageGenerationJob } from '../../../../lib/videoImageGenerationService';
import { enforceUserConcurrency } from '../../../../lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservationPeriodKey: string | null = null;
  let reservationRolledBack = false;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

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

  try {
    const parsed = await parseJson(req, StoryboardJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { storyboardId, force } = parsed.data;
    const forceRerun = force === true;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      select: { id: true, projectId: true },
    });

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

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.reason },
        { status: 429 },
      );
    }

    if (process.env.NODE_ENV === 'production') {
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
      JobType.VIDEO_IMAGE_GENERATION,
      storyboardId,
      forceRerun ? 'force' : 'normal',
    ]);
    const existing = await prisma.job.findFirst({
      where: {
        projectId,
        type: JobType.VIDEO_IMAGE_GENERATION,
        idempotencyKey,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { jobId: existing.id, reused: true },
        { status: 200 },
      );
    }

    try {
      const reserved = await reserveQuota(userId, planId, 'videoJobs', 1);
      reservationPeriodKey = (reserved as any).periodKey;
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'videoJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    try {
      const job = await prisma.job.create({
        data: {
          projectId,
          type: JobType.VIDEO_IMAGE_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload: { storyboardId, idempotencyKey, force: forceRerun },
        },
      });
      jobId = job.id;
    } catch (err: any) {
      const code = String(err?.code ?? '');
      const message = String(err?.message ?? '');
      const isUnique = code === 'P2002' || message.toLowerCase().includes('unique constraint');
      if (!isUnique) throw err;

      if (reservationPeriodKey) {
        await rollbackQuota(userId, reservationPeriodKey, 'videoJobs', 1);
        reservationRolledBack = true;
      }

      const raceExisting = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.VIDEO_IMAGE_GENERATION,
          idempotencyKey,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (raceExisting?.id) {
        return NextResponse.json(
          { jobId: raceExisting.id, reused: true },
          { status: 200 },
        );
      }

      throw err;
    }

    const result = await startVideoImageGenerationJob({
      storyboardId,
      jobId,
      force: forceRerun,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-images',
      },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId,
        reused: false,
        sceneCount: result.sceneCount,
        updatedSceneIds: result.updatedSceneIds,
        firstFrameUrls: result.firstFrameUrls ?? [],
        lastFrameUrls: result.lastFrameUrls ?? [],
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error(err);
    if (reservationPeriodKey && !reservationRolledBack) {
      await rollbackQuota(userId, reservationPeriodKey, 'videoJobs', 1);
      reservationRolledBack = true;
    }
    if (jobId) {
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.FAILED,
            error: String(err?.message ?? err),
          },
        });
      } catch {
        // ignore update errors
      }
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-images',
        error: String(err?.message ?? err),
      },
    });
    const message = String(err?.message ?? err ?? 'Video image generation failed');
    const lower = message.toLowerCase();
    const isKieMissing =
      lower.includes('kie') &&
      (lower.includes('not configured') || lower.includes('kie_api_key'));
    return NextResponse.json(
      { error: isKieMissing ? 'KIE not configured' : message },
      { status: 500 },
    );
  }
}
