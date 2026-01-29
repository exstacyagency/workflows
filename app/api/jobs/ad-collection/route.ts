// app/api/jobs/ad-collection/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from '@prisma/client';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '@/lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '@/lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '@/lib/billing/usage';
import { addJob, QueueName } from '@/lib/queue';
import { randomUUID } from 'crypto';

const AdCollectionSchema = ProjectJobSchema.extend({
  industryCode: z.string().min(1, 'industryCode is required'),
  runId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let didReserveQuota = false;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    const parsed = await parseJson(req, AdCollectionSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }

    const { projectId: parsedProjectId, industryCode, runId } = parsed.data;
    projectId = parsedProjectId;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
      planId = await assertMinPlan(userId, 'FREE');
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

    // Create new research run if no runId provided
    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const run = await prisma.researchRun.create({
        data: { 
          projectId, 
          status: 'IN_PROGRESS' 
        }
      });
      effectiveRunId = run.id;
    }

    const idempotencyKey = randomUUID();

    try {
      await reserveQuota(userId, planId, 'adCollectionJobs', 1);
      didReserveQuota = true;
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'adCollectionJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.AD_PERFORMANCE,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload: { ...parsed.data, jobType: 'ad_raw_collection' },
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
        metadata: { type: "ad-collection", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
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

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.AD_PERFORMANCE,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload: { ...parsed.data, jobType: 'ad_raw_collection', idempotencyKey },
      },
    });
    jobId = job.id;

    await addJob(QueueName.AD_COLLECTION, job.id, {
      jobId: job.id,
      projectId,
      industryCode,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'ad-collection',
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: true },
      { status: 202 },
    );
  } catch (err: any) {
    if (didReserveQuota) {
      const periodKey = new Date().toISOString().slice(0, 7);
      await rollbackQuota(userId, periodKey, 'adCollectionJobs', 1).catch(console.error);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'ad-collection',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
