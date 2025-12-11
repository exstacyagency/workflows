// app/api/jobs/customer-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { runCustomerAnalysis } from '@/lib/customerAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, productName, productProblemSolved } = body;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (productName !== undefined && typeof productName !== 'string') {
      return NextResponse.json({ error: 'productName must be a string when provided' }, { status: 400 });
    }
    if (productProblemSolved !== undefined && typeof productProblemSolved !== 'string') {
      return NextResponse.json({ error: 'productProblemSolved must be a string when provided' }, { status: 400 });
    }
    const job = await prisma.job.create({
      data: {
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.RUNNING,
        projectId,
        payload: body,
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
