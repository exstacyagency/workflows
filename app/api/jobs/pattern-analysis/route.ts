// app/api/jobs/pattern-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';
import { runPatternAnalysis } from '@/lib/adPatternAnalysisService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJson(req, ProjectJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId } = parsed.data;

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
        type: JobType.PATTERN_ANALYSIS,
        status: JobStatus.RUNNING,
        projectId,
        payload: parsed.data,
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
