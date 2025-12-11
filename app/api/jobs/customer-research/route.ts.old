import { prisma } from '@/lib/prisma';
import { runPhase1A, type IdentifierType } from '@/services/Phase1AService';
import { runCustomerAnalysis } from '@/lib/customerAnalysisService';
import { JobStatus, JobType } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

function formatAnalysisJobSummary(result: Awaited<ReturnType<typeof runCustomerAnalysis>>) {
  const avatar = result.summary?.avatar;
  const product = result.summary?.product;
  const parts = [] as string[];
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const projectId = body?.projectId as string | undefined;
  const offeringName = body?.offeringName as string | undefined;
  const valueProp = body?.valueProp as string | undefined;
  const identifierType = body?.identifierType as IdentifierType | undefined;
  const identifier = body?.identifier as string | undefined;

  // Validate required fields
  if (!projectId || !offeringName || !valueProp || !identifierType) {
    return NextResponse.json(
      { error: 'projectId, offeringName, valueProp, and identifierType are required' },
      { status: 400 }
    );
  }

  // Validate identifier is provided when needed
  if (identifierType !== 'none' && !identifier) {
    return NextResponse.json(
      { error: `identifier is required when identifierType is ${identifierType}` },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const job = await prisma.job.create({
    data: {
      type: JobType.CUSTOMER_RESEARCH,
      status: JobStatus.PENDING,
      projectId,
      payload: {
        offeringName,
        valueProp,
        identifierType,
        identifier
      }
    }
  });

  try {
    const researchRows = await runPhase1A({
      projectId,
      jobId: job.id,
      offeringName,
      valueProp,
      identifierType,
      identifier
    });
    const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });

    let analysisJobRecord = null;
    let analysisSummary: Awaited<ReturnType<typeof runCustomerAnalysis>> | null = null;
    let analysisError: string | null = null;

    const analysisJob = await prisma.job.create({
      data: {
        type: JobType.CUSTOMER_ANALYSIS,
        status: JobStatus.RUNNING,
        projectId,
        payload: {
          triggeredByJobId: job.id,
          productName: offeringName,
          productProblemSolved: valueProp,
        },
      },
    });

    try {
      const result = await runCustomerAnalysis({
        projectId,
        productName: offeringName,
        productProblemSolved: valueProp,
        jobId: analysisJob.id,
      });
      analysisSummary = result;
      await prisma.job.update({
        where: { id: analysisJob.id },
        data: {
          status: JobStatus.COMPLETED,
          resultSummary: formatAnalysisJobSummary(result),
        },
      });
    } catch (analysisErr) {
      analysisError = analysisErr instanceof Error ? analysisErr.message : 'Customer analysis failed';
      await prisma.job.update({
        where: { id: analysisJob.id },
        data: {
          status: JobStatus.FAILED,
          error: analysisError,
        },
      });
    }

    analysisJobRecord = await prisma.job.findUnique({ where: { id: analysisJob.id } });

    return NextResponse.json({
      job: updatedJob,
      researchRows,
      customerAnalysis: {
        job: analysisJobRecord,
        summary: analysisSummary?.summary ?? null,
        productName: analysisSummary?.productName,
        productProblemSolved: analysisSummary?.productProblemSolved,
        error: analysisError,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
