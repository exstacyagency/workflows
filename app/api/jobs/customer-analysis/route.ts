// app/api/jobs/customer-analysis/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from '@prisma/client';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { randomUUID } from 'crypto';

const CustomerAnalysisSchema = ProjectJobSchema.extend({
  productName: z.string().optional(),
  productProblemSolved: z.string().optional(),
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
    const parsed = await parseJson(req, CustomerAnalysisSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }

    const { projectId: parsedProjectId, productName, productProblemSolved, runId } = parsed.data;
    projectId = parsedProjectId;
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

    // Get runId from request or find most recent completed research job
    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const latestResearch = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.CUSTOMER_RESEARCH,
          status: JobStatus.COMPLETED,
          runId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { runId: true },
      });
      effectiveRunId = latestResearch?.runId ?? undefined;
    }

    if (!effectiveRunId) {
      return NextResponse.json(
        { error: 'No completed customer research job found. Please run customer research first.' },
        { status: 400 }
      );
    }

    const idempotencyKey = randomUUID();
    const payload = { ...parsed.data, runId: effectiveRunId, idempotencyKey };

    try {
      await reserveQuota(userId, planId, 'researchQueries', 1);
      didReserveQuota = true;
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
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
          type: JobType.CUSTOMER_ANALYSIS,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload,
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
        metadata: { type: "customer-analysis", skipped: true, reason: "SECURITY_SWEEP" },
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
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload,
      },
    });
    jobId = job.id;

    // Job will be picked up by jobRunner worker (no queue needed)

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'customer-analysis',
      },
    });

    return NextResponse.json(
      { jobId, started: true },
      { status: 202 },
    );
  } catch (err: any) {
    if (didReserveQuota) {
      const periodKey = new Date().toISOString().slice(0, 7);
      await rollbackQuota(userId, periodKey, 'researchQueries', 1).catch(console.error);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'customer-analysis',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
