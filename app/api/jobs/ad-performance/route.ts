// app/api/jobs/ad-performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startAdRawCollectionJob } from '../../../../lib/adRawCollectionService';
import { prisma } from '../../../../lib/prisma';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

const AdPerformanceSchema = ProjectJobSchema.extend({
  industryCode: z.string().min(1, 'industryCode is required'),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
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
    const parsed = await parseJson(req, AdPerformanceSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId: parsedProjectId, industryCode } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!process.env.APIFY_API_TOKEN || !process.env.APIFY_DATASET_ID) {
      const isCIOrTest =
        process.env.CI === 'true' || process.env.NODE_ENV === 'test';
      if (isCIOrTest) {
        return NextResponse.json(
          { ok: true, skipped: true, reason: 'Apify not configured' },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { error: 'Apify is not configured' },
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

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.AD_PERFORMANCE,
      industryCode,
    ]);
    const existing = await findIdempotentJob({
      projectId,
      type: JobType.AD_PERFORMANCE,
      idempotencyKey,
    });
    if (existing) {
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
    }

    try {
      reservation = await reserveQuota(userId, planId, 'researchQueries', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          {
            error: 'Quota exceeded',
            metric: 'researchQueries',
            limit: err.limit,
            used: err.used,
          },
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

    const job = await prisma.job.create({
      data: {
        projectId,
        type: JobType.AD_PERFORMANCE,
        status: JobStatus.PENDING,
        payload: { projectId, industryCode, idempotencyKey },
      },
    });
    jobId = job.id;

    let result: any;
    try {
      result = await startAdRawCollectionJob({
        projectId,
        industryCode,
        jobId: job.id,
      });
    } catch (err: any) {
      const message = String(err?.message ?? err);
      try {
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            payload: { projectId, industryCode, idempotencyKey, error: message },
          },
        });
      } catch (updateErr) {
        console.error('Failed to mark job failed', updateErr);
      }
      return NextResponse.json(
        { jobId: job.id, started: false, error: message },
        { status: 200 },
      );
    }

    try {
      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.create',
        ip,
        metadata: {
          type: 'ad-performance',
        },
      });
    } catch (err) {
      console.error('logAudit failed', err);
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (jobId) {
      const message = String(err?.message ?? err);
      try {
        const existing = await prisma.job.findUnique({
          where: { id: jobId },
          select: { payload: true },
        });
        const payload =
          existing?.payload && typeof existing.payload === 'object'
            ? existing.payload
            : {};
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.FAILED,
            payload: { ...(payload as any), error: message },
          },
        });
      } catch (updateErr) {
        console.error('Failed to mark job failed', updateErr);
      }
      return NextResponse.json(
        { jobId, started: false, error: message },
        { status: 200 },
      );
    }
    if (reservation && !jobId) {
      await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
    }
    try {
      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.error',
        ip,
        metadata: {
          type: 'ad-performance',
          error: String(err?.message ?? err),
        },
      });
    } catch (auditErr) {
      console.error('logAudit failed', auditErr);
    }
    return NextResponse.json(
      { error: err?.message ?? 'Ad performance collection failed' },
      { status: 500 },
    );
  }
}
