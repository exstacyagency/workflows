import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JobType } from '@prisma/client';
import { estimateCustomerResearchCost, checkBudget } from '@/lib/costEstimator';
import { checkRateLimit } from '@/lib/rateLimiter';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { z } from 'zod';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '@/lib/billing/requirePlan';

export const runtime = 'nodejs';

const CustomerResearchSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, 'productName is required'),
  productProblemSolved: z.string().min(1, 'productProblemSolved is required'),
  productAmazonAsin: z.string().min(1, 'productAmazonAsin is required'),
  competitor1AmazonAsin: z.string().optional(),
  competitor2AmazonAsin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await assertMinPlan(userId, 'GROWTH');
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
    const parsed = await parseJson(req, CustomerResearchSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }
    const {
      projectId: parsedProjectId,
      productName,
      productProblemSolved,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
    } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limitCheck = await enforcePlanLimits(userId);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason },
        { status: 403 },
      );
    }

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.reason },
        { status: 429 },
      );
    }

    await incrementUsage(userId, 'job', 1);

    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 }
        );
      }
    }

    const costEstimate = await estimateCustomerResearchCost({
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
    });

    const budgetOk = await checkBudget(projectId, costEstimate.totalCost);
    if (!budgetOk) {
      return NextResponse.json(
        {
          error: 'Budget exceeded',
          estimate: costEstimate,
        },
        { status: 402 }
      );
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.CUSTOMER_RESEARCH,
      productAmazonAsin,
      competitor1AmazonAsin ?? '',
      competitor2AmazonAsin ?? '',
      productName,
      productProblemSolved,
    ]);

    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.CUSTOMER_RESEARCH,
      idempotencyKey,
      payload: {
        projectId,
        productName,
        productProblemSolved,
        productAmazonAsin,
        competitor1AmazonAsin,
        competitor2AmazonAsin,
        estimatedCost: costEstimate.totalCost,
      },
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 202 });
    }

    const { addJob, QueueName } = await import('@/lib/queue');

    await addJob(QueueName.CUSTOMER_RESEARCH, job.id, {
      jobId: job.id,
      projectId,
      productName,
      productProblemSolved,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'customer-research',
      },
    });

    return NextResponse.json(
      {
        jobId: job.id,
        estimatedCost: costEstimate.totalCost,
        breakdown: costEstimate.breakdown,
      },
      { status: 202 }
    );
  } catch (error: any) {
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'customer-research',
        error: String(error?.message ?? error),
      },
    });
    console.error('[API] Customer research job creation failed:', error);
    return NextResponse.json(
      { error: error?.message ?? 'Customer research job creation failed' },
      { status: 500 }
    );
  }
}
