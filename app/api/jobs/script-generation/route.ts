// app/api/jobs/script-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startScriptGenerationJob } from '@/lib/scriptGenerationService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import prisma from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { logAudit } from '@/lib/logger';
import { getSessionUser } from '@/lib/getSessionUser';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

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
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status },
    );
  }

  const userId = user.id;

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

  try {
    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const idempotencyKey = JSON.stringify([projectId, JobType.SCRIPT_GENERATION]);
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.SCRIPT_GENERATION,
      idempotencyKey,
      payload: parsed.data,
    });
    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    const runningJob = await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.RUNNING },
    });
    const jobId = runningJob.id;

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'script-generation',
      },
    });

    const result = await startScriptGenerationJob(projectId, runningJob);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    await logAudit({
      userId,
      projectId,
      jobId: null,
      action: 'job.error',
      ip,
      metadata: {
        type: 'script-generation',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Script generation failed' },
      { status: 500 },
    );
  }
}
