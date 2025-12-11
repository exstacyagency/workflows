import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';
import { estimateCustomerResearchCost, checkBudget } from '@/lib/costEstimator';
import { checkRateLimit } from '@/lib/rateLimiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, productName, productProblemSolved, productAmazonAsin, competitor1AmazonAsin, competitor2AmazonAsin } = body;

    if (!projectId || !productName || !productProblemSolved || !productAmazonAsin) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const rateCheck = await checkRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded: ${rateCheck.reason}` },
        { status: 429 }
      );
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

    const job = await prisma.job.create({
      data: {
        type: JobType.CUSTOMER_RESEARCH,
        status: JobStatus.PENDING,
        projectId,
        payload: { 
          projectId, 
          productName, 
          productProblemSolved, 
          productAmazonAsin, 
          competitor1AmazonAsin, 
          competitor2AmazonAsin,
          estimatedCost: costEstimate.totalCost,
        },
      },
    });

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

    return NextResponse.json({ 
      jobId: job.id,
      estimatedCost: costEstimate.totalCost,
      breakdown: costEstimate.breakdown,
    }, { status: 202 });
  } catch (err: any) {
    console.error('[API] Customer research job creation failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
