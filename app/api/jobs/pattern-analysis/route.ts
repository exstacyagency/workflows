// app/api/jobs/pattern-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';
import { runPatternAnalysis } from '@/lib/adPatternAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';
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
    const parsed = await parseJson(req, ProjectJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    projectId = parsed.data.projectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Anthropic is not configured' },
        { status: 500 },
      );
    }

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.reason },
        { status: 429 },
      );
    }

    let periodKey = getCurrentPeriodKey();
    try {
      const quota = await assertQuota(userId, planId, 'researchQueries', 1);
      periodKey = quota.periodKey;
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
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

    const idempotencyKey = JSON.stringify([projectId, JobType.PATTERN_ANALYSIS]);
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.PATTERN_ANALYSIS,
      idempotencyKey,
      payload: parsed.data,
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.RUNNING },
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'pattern-analysis',
      },
    });

    try {
      const result = await runPatternAnalysis({ projectId, jobId: job.id });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          resultSummary: `Pattern analysis complete (resultId=${result.id})`,
        },
      });

      await incrementUsage(userId, periodKey, 'researchQueries', 1);

      return NextResponse.json(
        { jobId: job.id, resultId: result.id },
        { status: 200 },
      );
    } catch (err: any) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          error: err?.message ?? 'Unknown error',
        },
      });

      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.error',
        ip,
        metadata: {
          type: 'pattern-analysis',
          error: String(err?.message ?? err),
        },
      });

      return NextResponse.json(
        { error: err?.message ?? 'Pattern analysis failed' },
        { status: 500 },
      );
    }
  } catch (err: any) {
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'pattern-analysis',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
