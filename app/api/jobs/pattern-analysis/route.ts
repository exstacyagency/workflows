import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { JobType, JobStatus, Prisma } from '@prisma/client';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency } from '../../../../lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

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

    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    if (securitySweep) {
      const sweepIdempotencyKey = JSON.stringify([
        projectId,
        JobType.PATTERN_ANALYSIS,
        "SECURITY_SWEEP",
      ]);
      try {
        reservation = await reserveQuota(userId, planId, 'researchQueries', 1);
      } catch (err: any) {
        if (err instanceof QuotaExceededError) {
          return NextResponse.json(
            { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
            { status: 429 },
          );
        }
        throw err;
      }

      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.PATTERN_ANALYSIS,
          status: JobStatus.PENDING,
          idempotencyKey: sweepIdempotencyKey,
          payload: parsed.data,
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
        select: { id: true },
      });
      jobId = job.id;
      await logAudit({
        userId,
        projectId,
        jobId,
        action: "job.create",
        ip,
        metadata: { type: "pattern-analysis", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
      );
    }

    const customerResearchJob = await prisma.job.findFirst({
      where: { projectId, type: JobType.CUSTOMER_RESEARCH, status: JobStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const adPerformanceJob = await prisma.job.findFirst({
      where: { projectId, type: JobType.AD_PERFORMANCE, status: JobStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const missing: string[] = [];
    if (!customerResearchJob?.id) missing.push('CUSTOMER_RESEARCH');
    if (!adPerformanceJob?.id) missing.push('AD_PERFORMANCE');
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Missing dependencies', missing },
        { status: 400 },
      );
    }
    if (!customerResearchJob || !adPerformanceJob) {
      return NextResponse.json(
        { error: 'Missing dependencies', missing: ['CUSTOMER_RESEARCH', 'AD_PERFORMANCE'] },
        { status: 400 },
      );
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.PATTERN_ANALYSIS,
      customerResearchJob.id,
      adPerformanceJob.id,
    ]);

    const existing = await prisma.job.findFirst({
      where: {
        projectId,
        type: JobType.PATTERN_ANALYSIS,
        AND: [
          { payload: { path: ['customerResearchJobId'], equals: customerResearchJob.id } },
          { payload: { path: ['adPerformanceJobId'], equals: adPerformanceJob.id } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing?.id) {
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
    }

    try {
      reservation = await reserveQuota(userId, planId, 'researchQueries', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
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

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.PATTERN_ANALYSIS,
        status: JobStatus.PENDING,
        idempotencyKey,
        payload: {
          projectId,
          customerResearchJobId: customerResearchJob.id,
          adPerformanceJobId: adPerformanceJob.id,
          idempotencyKey,
          quotaReservation: reservation
            ? { periodKey: reservation.periodKey, metric: 'researchQueries', amount: 1 }
            : null,
        },
      },
    });
    jobId = job.id;

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

    return NextResponse.json({ jobId, started: false }, { status: 200 });
  } catch (err: any) {
    if (reservation) {
      await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
    }
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
