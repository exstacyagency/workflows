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
  productProblemSolved: z.string().optional(),
  mainProductAsin: z.string().optional(),
  competitor1Asin: z.string().optional(),
  competitor2Asin: z.string().optional(),
  competitor3Asin: z.string().optional(),
  // Backward compatibility aliases
  productAmazonAsin: z.string().optional(),
  competitor1AmazonAsin: z.string().optional(),
  competitor2AmazonAsin: z.string().optional(),
  forceNew: z.boolean().optional().default(false),
  // Reddit search parameters
  redditKeywords: z.array(z.string()).optional(),
  searchIntent: z.array(z.string()).optional(),
  solutionKeywords: z.array(z.string()).optional(),
  additionalProblems: z.array(z.string()).optional(),
  redditSubreddits: z.array(z.string()).optional(),
  maxPosts: z.number().optional(),
  maxCommentsPerPost: z.number().optional(),
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
      productId,
      productProblemSolved,
      mainProductAsin,
      competitor1Asin,
      competitor2Asin,
      competitor3Asin,
      productAmazonAsin,
      competitor1AmazonAsin,
      competitor2AmazonAsin,
      forceNew,
      redditKeywords,
      searchIntent,
      solutionKeywords,
      additionalProblems,
      redditSubreddits,
      maxPosts,
      maxCommentsPerPost,
      timeRange,
      scrapeComments,
    } = parsed.data;
    projectId = parsedProjectId;

    const resolvedMainProductAsin = (mainProductAsin || productAmazonAsin || '').trim() || undefined;
    const resolvedCompetitor1Asin =
      (competitor1Asin || competitor1AmazonAsin || '').trim() || undefined;
    const resolvedCompetitor2Asin =
      (competitor2Asin || competitor2AmazonAsin || '').trim() || undefined;
    const resolvedCompetitor3Asin = (competitor3Asin || '').trim() || undefined;
    const hasAmazonAsin = Boolean(
      resolvedMainProductAsin ||
        resolvedCompetitor1Asin ||
        resolvedCompetitor2Asin ||
        resolvedCompetitor3Asin
    );
    const hasRedditParams =
      Boolean(productProblemSolved?.trim()) ||
      Boolean(redditKeywords?.length) ||
      Boolean(searchIntent?.length) ||
      Boolean(solutionKeywords?.length) ||
      Boolean(additionalProblems?.length) ||
      Boolean(redditSubreddits?.length) ||
      typeof maxPosts === "number" ||
      typeof maxCommentsPerPost === "number" ||
      Boolean(timeRange) ||
      typeof scrapeComments === "boolean";
    const hasRedditData = Boolean(productProblemSolved?.trim());
    if (hasRedditParams && !productProblemSolved?.trim()) {
      return NextResponse.json(
        { error: "Problem to Research is required for Reddit scraping" },
        { status: 400 }
      );
    }
    if (!hasAmazonAsin && !hasRedditData) {
      return NextResponse.json(
        { error: "Provide either Amazon ASIN or Problem to Research for Reddit scraping" },
        { status: 400 }
      );
    }

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
          mainProductAsin: resolvedMainProductAsin,
          competitor1Asin: resolvedCompetitor1Asin,
          competitor2Asin: resolvedCompetitor2Asin,
          competitor3Asin: resolvedCompetitor3Asin,
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
      ...(productId && { productId }),
      productProblemSolved,
      mainProductAsin: resolvedMainProductAsin,
      competitor1Asin: resolvedCompetitor1Asin,
      competitor2Asin: resolvedCompetitor2Asin,
      competitor3Asin: resolvedCompetitor3Asin,
      estimatedCost: costEstimate.totalCost ?? 0,
      idempotencyKey,
      skipped: securitySweep,
      reason: securitySweep ? "SECURITY_SWEEP" : null,
      // Reddit search parameters
      ...(redditKeywords && { redditKeywords }),
      ...(searchIntent && { searchIntent }),
      ...(solutionKeywords && { solutionKeywords }),
      ...(additionalProblems && { additionalProblems }),
      ...(redditSubreddits && { redditSubreddits }),
      ...(typeof maxPosts === 'number' && { maxPosts }),
      ...(typeof maxCommentsPerPost === 'number' && { maxCommentsPerPost }),
      ...(timeRange && { timeRange }),
      ...(typeof scrapeComments === 'boolean' && { scrapeComments }),
    };

    console.log("=== CREATING CUSTOMER RESEARCH JOB ===");
    console.log("Job status:", securitySweep ? "COMPLETED" : "PENDING");
    console.log("Security sweep?", securitySweep);

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

    console.log("Job created:", job.id, "Status:", job.status);
    console.log("===================================");

    if (securitySweep) {
      await prisma.researchRow.createMany({
        data: [
          {
            projectId,
            jobId,
            source: ResearchSource.REDDIT_PRODUCT,
            type: "post",
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
