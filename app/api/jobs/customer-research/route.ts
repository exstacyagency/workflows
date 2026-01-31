// app/api/jobs/customer-research/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { JobStatus, JobType, ResearchSource, Prisma } from '@prisma/client';
import { estimateCustomerResearchCost, checkBudget } from '../../../../lib/costEstimator';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { z } from 'zod';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';
import { updateJobStatus } from "@/lib/jobs/updateJobStatus";
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const CustomerResearchSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, 'productName is required'),
  productProblemSolved: z.string().min(1, 'productProblemSolved is required'),
  productAmazonAsin: z.string().min(1, 'productAmazonAsin is required'),
  competitor1AmazonAsin: z.string().optional(),
  competitor2AmazonAsin: z.string().optional(),
  forceNew: z.boolean().optional().default(false),
  // Reddit search parameters
  redditKeywords: z.array(z.string()).optional(),
  redditSubreddits: z.array(z.string()).optional(),
  maxPosts: z.number().optional(),
  timeRange: z.enum(['week', 'month', 'year', 'all']).optional(),
  scrapeComments: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

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
      forceNew,
      redditKeywords,
      redditSubreddits,
      maxPosts,
      timeRange,
      scrapeComments,
    } = parsed.data;
    projectId = parsedProjectId;

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    // REMOVED: Plan check (lines 47-58)
    // REMOVED: Apify check (lines 60-67)
    // REMOVED: Concurrency check (lines 69-76)

    if (cfg.raw("NODE_ENV") === 'production' && cfg.raw("FORCE_RATE_LIMIT") === "1") {
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

    // REMOVED: Budget check (lines 84-95)

    // Create new research run
    const run = await prisma.researchRun.create({
      data: { 
        projectId, 
        status: 'IN_PROGRESS' 
      }
    });

    const idempotencyKey = randomUUID();

    // REMOVED: Quota reservation (lines 123-134)

    const initialPayload: any = {
      projectId,
      productName,
      productProblemSolved,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
      estimatedCost: costEstimate.totalCost ?? 0,
      idempotencyKey,
      skipped: securitySweep,
      reason: securitySweep ? "SECURITY_SWEEP" : null,
      // Reddit search parameters
      ...(redditKeywords && { redditKeywords }),
      ...(redditSubreddits && { redditSubreddits }),
      ...(maxPosts && { maxPosts }),
      ...(timeRange && { timeRange }),
      ...(typeof scrapeComments === 'boolean' && { scrapeComments }),
    };

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.CUSTOMER_RESEARCH,
        status: securitySweep ? JobStatus.COMPLETED : JobStatus.PENDING,
        idempotencyKey,
        runId: run.id,
        payload: initialPayload,
        resultSummary: securitySweep ? "Skipped: SECURITY_SWEEP" : undefined,
        error: Prisma.JsonNull,
      },
    });
    jobId = job.id;

    if (securitySweep) {
      await prisma.researchRow.createMany({
        data: [
          {
            projectId,
            jobId,
            source: ResearchSource.REDDIT_PRODUCT,
            content: "Deterministic placeholder research content.",
            metadata: {
              indexLabel: "golden",
              title: "SECURITY_SWEEP placeholder",
              verified: false,
              importance: 0,
              rating: 0,
            },
          },
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
      { jobId, runId: run.id, started: !securitySweep, skipped: securitySweep, reason: securitySweep ? "SECURITY_SWEEP" : null },
      { status: 200 },
    );
  } catch (error: any) {
    // REMOVED: Quota rollback (lines 205-207)
    if (jobId) {
      try {
        await updateJobStatus(jobId, JobStatus.FAILED);
        await prisma.job.update({ where: { id: jobId }, data: { error: String(error?.message ?? error) } });
      } catch (e) {
        console.error('Failed to mark job as failed after setup error', e);
      }
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