// app/api/jobs/customer-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { runCustomerAnalysis } from '@/lib/customerAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';

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
  try {
    const parsed = await parseJson(req, CustomerAnalysisSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error, details: parsed.details }, { status: 400 });
    }

    const { projectId, productName, productProblemSolved } = parsed.data;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const rateCheck = await checkRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded: ${rateCheck.reason}` },
        { status: 429 },
      );
    }
    const job = await prisma.job.create({
      data: {
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.RUNNING,
        projectId,
        payload: parsed.data,
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

      return NextResponse.json(
        { error: err?.message ?? 'Customer analysis failed' },
        { status: 500 },
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
