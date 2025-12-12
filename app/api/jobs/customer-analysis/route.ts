// app/api/jobs/customer-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { runCustomerAnalysis } from '@/lib/customerAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUser } from '@/lib/getSessionUser';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';

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
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

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
    const userId = auth.user?.id ?? user.id;

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
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.CUSTOMER_ANALYSIS,
      idempotencyKey,
      payload: parsed.data,
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.RUNNING },
    });

    await logAudit({
      userId: user?.id ?? null,
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
        jobId: job.id,
      });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          resultSummary: formatAnalysisJobSummary(result),
        },
      });

      return NextResponse.json(
        { jobId: job.id, ...result },
        { status: 200 },
      );
    } catch (err: any) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          error: err?.message ?? 'Unknown error',
        },
      });

      await logAudit({
        userId: user?.id ?? null,
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
    await logAudit({
      userId: user?.id ?? null,
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
