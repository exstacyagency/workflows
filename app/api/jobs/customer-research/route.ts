import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { estimateCustomerResearchCost, checkBudget } from '../../../../lib/costEstimator';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { z } from 'zod';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

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
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

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

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    // Plan check AFTER ownership to avoid leaking project existence via 402.
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
      if (!cfg.raw("APIFY_TOKEN") && !cfg.raw("APIFY_API_TOKEN")) {
        return NextResponse.json(
          { error: 'Apify is not configured' },
          { status: 500 },
        );
      }
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

    if (cfg.raw("NODE_ENV") === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 }
        );
      }
    }

    const costEstimate = securitySweep
      ? { totalCost: 0 }
      : await estimateCustomerResearchCost({
          productAmazonAsin,
          competitor1AmazonAsin,
          competitor2AmazonAsin,
        });

    if (!securitySweep) {
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

  const existing = await findIdempotentJob({
    projectId,
    type: JobType.CUSTOMER_RESEARCH,
    idempotencyKey,
  });
  if (existing) {
    // If we’re in SECURITY_SWEEP, callers expect deterministic placeholder semantics.
    // Returning skipped:true avoids brittle smoke tests while preserving idempotency behavior.
    if (securitySweep) {
      return NextResponse.json(
        { jobId: existing.id, reused: true, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 }
      );
    }
    return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
  }

    // Reserve quota regardless of security sweep. Sweep should not be a billing bypass.
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

    const initialPayload: any = {
      projectId,
      productName,
      productProblemSolved,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
      estimatedCost: costEstimate.totalCost ?? 0,
      idempotencyKey,
      quotaReservation: reservation
        ? { periodKey: reservation.periodKey, metric: 'researchQueries', amount: 1 }
        : null,
      skipped: securitySweep,
      reason: securitySweep ? "SECURITY_SWEEP" : null,
    };

    const job = await prisma.job.create({
      data: {
        projectId,
        type: JobType.CUSTOMER_RESEARCH,
        status: securitySweep ? JobStatus.PENDING : JobStatus.PENDING,
        payload: initialPayload,
        resultSummary: securitySweep ? "Skipped: SECURITY_SWEEP" : null,
        error: null,
      },
    });
    jobId = job.id;

    if (securitySweep) {
      // Deterministic placeholder but still a real queued job state/usage record.
      await prisma.researchRow.createMany({
        data: [
          {
            projectId,
            jobId,
            source: "REDDIT",
            indexLabel: "golden",
            title: "SECURITY_SWEEP placeholder",
            content: "Deterministic placeholder research content.",
            verified: false,
            importance: 0,
            rating: 0,
          } as any,
        ],
      });
    }

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
      { jobId, started: !securitySweep, skipped: securitySweep, reason: securitySweep ? "SECURITY_SWEEP" : null },
      { status: 200 },
    );
  } catch (error: any) {
    if (reservation && !jobId) {
      await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
    }
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
