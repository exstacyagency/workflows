// app/api/jobs/video-reviewer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runVideoReviewer } from '@/lib/videoReviewerService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import prisma from '@/lib/prisma';
import { StoryboardJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, StoryboardJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { storyboardId } = parsed.data;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      include: {
        script: {
          include: { project: true },
        },
      },
    });

    if (!storyboard || !storyboard.script?.project) {
      return NextResponse.json(
        { error: 'Storyboard or project not found' },
        { status: 404 },
      );
    }

    projectId = storyboard.script.project.id;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
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
      JobType.VIDEO_REVIEW,
      storyboardId,
    ]);
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.VIDEO_REVIEW,
      idempotencyKey,
      payload: { storyboardId },
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.RUNNING },
    });

    const result = await runVideoReviewer();

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: `Video reviewer merged ${result.merged.length} storyboards`,
      },
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-reviewer',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (jobId) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error: err?.message ?? 'Video reviewer failed',
        },
      });
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-reviewer',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Video reviewer failed' },
      { status: 500 },
    );
  }
}
