// app/api/jobs/pattern-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';
import { runPatternAnalysis } from '@/lib/adPatternAnalysisService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId } = body;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 },
      );
    }

    const job = await prisma.job.create({
      data: {
        type: JobType.PATTERN_ANALYSIS,
        status: JobStatus.RUNNING,
        projectId,
        payload: body,
      },
    });

    try {
      const result = await runPatternAnalysis(projectId, job.id);

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          resultSummary: `Pattern analysis complete (resultId=${result.id})`,
        },
      });

      return NextResponse.json(
        { jobId: job.id, resultId: result.id },
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
        { error: err?.message ?? 'Pattern analysis failed' },
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
