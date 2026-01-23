// app/api/jobs/customer-analysis/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from '@prisma/client';
import { runCustomerAnalysis } from '../../../../lib/customerAnalysisService';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";

function formatAnalysisJobSummary(result: Awaited<ReturnType<typeof runCustomerAnalysis>>) {
  const avatar = result.summary?.avatar;
  const product = result.summary?.product;
  const parts: string[] = [];
  if (avatar?.primaryPain) {
    parts.push(`Avatar pain: ${avatar.primaryPain}`);
  }
  if (product?.heroIngredient) {
    parts.push(`Hero ingredient: ${product.heroIngredient}`);
  }
  return parts.length
    ? `Customer analysis complete for ${result.productName}. ${parts.join(' | ')}`
    : `Customer analysis complete for ${result.productName}.`;
}

const CustomerAnalysisSchema = ProjectJobSchema.extend({
  productName: z.string().optional(),
  productProblemSolved: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg().raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    const parsed = await parseJson(req, CustomerAnalysisSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }

    const { projectId: parsedProjectId, productName, productProblemSolved } = parsed.data;
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

    // SECURITY_SWEEP should never be blocked by concurrency.
    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.CUSTOMER_ANALYSIS,
      productName ?? '',
      productProblemSolved ?? '',
    ]);
    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JobType.CUSTOMER_ANALYSIS,
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
        metadata: { type: "customer-analysis", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
      );
    }

    // External calls below (only when not securitySweep)...
    if (!cfg().raw("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: 'Anthropic is not configured' },
        { status: 500 },
      );
    }

    if (cfg().raw("NODE_ENV") === 'production') {
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
        payload: { ...parsed.data, idempotencyKey },
      },
    });
    jobId = job.id;

    await updateJobStatus(jobId, JobStatus.RUNNING);

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

    try {
      const result = await runCustomerAnalysis({
        projectId,
        productName,
        productProblemSolved,
        jobId,
      });

        await updateJobStatus(jobId, JobStatus.COMPLETED);
        await prisma.job.update({
          where: { id: jobId },
          data: { resultSummary: formatAnalysisJobSummary(result) },
        });

      return NextResponse.json(
        { jobId, ...result },
        { status: 200 },
      );
    } catch (err: any) {
      if (reservation) {
        await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
        reservation = null;
      }
        await updateJobStatus(jobId, JobStatus.FAILED);
        await prisma.job.update({
          where: { id: jobId },
          data: { error: err?.message ?? 'Unknown error' },
        });

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
        { error: err?.message ?? 'Customer analysis failed' },
        { status: 500 },
      );
    }
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
