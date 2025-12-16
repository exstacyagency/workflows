// app/api/jobs/video-prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startVideoPromptGenerationJob } from '@/lib/videoPromptGenerationService';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { StoryboardJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';
import { JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '@/lib/billing/requirePlan';
import { assertQuota, getCurrentPeriodKey, incrementUsage, QuotaExceededError } from '../../../../lib/billing/usage';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

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
      include: {
        script: {
          include: { project: true },
        },
      },
    });
    if (!storyboard || !storyboard.script?.project) {
      return NextResponse.json(
        { error: 'Storyboard or project not found' },
        { status: 404 },
      );
    }

    projectId = storyboard.script.project.id;
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

    const periodKey = getCurrentPeriodKey();
    try {
      await assertQuota(userId, planId, 'videoJobs', 1);
      await incrementUsage(userId, periodKey, 'videoJobs', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'videoJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
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
      JobType.VIDEO_PROMPT_GENERATION,
      storyboardId,
    ]);
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      idempotencyKey,
      payload: { storyboardId },
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    const result = await startVideoPromptGenerationJob({
      storyboardId,
      jobId: job.id,
    });

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

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
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
