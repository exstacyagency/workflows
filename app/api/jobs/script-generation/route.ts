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
import { enforceUserConcurrency } from '@/lib/jobGuards';

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

  const idempotencyKey = `script-generation:${projectId}`;

  const existingJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: JobType.SCRIPT_GENERATION,
      idempotencyKey,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingJob) {
    const existingScript = await prisma.script.findFirst({
      where: {
        projectId,
        jobId: existingJob.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      {
        jobId: existingJob.id,
        scriptId: existingScript?.id ?? null,
        script: existingScript ?? null,
        reused: true,
      },
      { status: 200 },
    );
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

    let job;
    try {
      job = await prisma.job.create({
        data: {
          type: JobType.SCRIPT_GENERATION,
          status: JobStatus.RUNNING,
          projectId,
          idempotencyKey,
          payload: { idempotencyKey },
        },
      });
    } catch (createErr: any) {
      if (createErr?.code === 'P2002') {
        const existingJob = await prisma.job.findFirst({
          where: {
            projectId,
            type: JobType.SCRIPT_GENERATION,
            idempotencyKey,
            status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingJob) {
          return NextResponse.json(
            { jobId: existingJob.id, reused: true },
            { status: 200 },
          );
        }
      }

      throw createErr;
    }
    const jobId = job.id;

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

    const result = await startScriptGenerationJob(projectId, job);

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
