// app/api/jobs/script-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startScriptGenerationJob } from '@/lib/scriptGenerationService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import { prisma } from '@/lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { logAudit } from '@/lib/logger';
import { getSessionUser } from '@/lib/getSessionUser';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { enforceUserConcurrency } from '@/lib/jobGuards';
import { runWithState } from '@/lib/jobRuntime';

export async function POST(req: NextRequest) {
  try {
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
    const devTest = process.env.FF_DEV_TEST_MODE === 'true';
    const idempotencyKey = `script-generation:${projectId}`;

    if (!devTest) {
      const limitCheck = await enforcePlanLimits(userId);
      if (!limitCheck.allowed) {
        return NextResponse.json(
          { error: limitCheck.reason },
          { status: 403 },
        );
      }
    }

    if (!devTest) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    if (!devTest) {
      await incrementUsage(userId, 'job', 1);
    }

    if (!devTest && process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

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
        where: { projectId, jobId: existingJob.id },
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

    let job;
    try {
      job = await prisma.job.create({
        data: {
          projectId,
          type: JobType.SCRIPT_GENERATION,
          status: JobStatus.RUNNING,
          idempotencyKey,
          payload: { ...parsed.data, idempotencyKey },
        },
      });
    } catch (e: any) {
      const message = String(e?.message ?? '');
      const isUnique =
        e?.code === 'P2002' ||
        (e?.name === 'PrismaClientKnownRequestError' && e?.meta?.target) ||
        message.includes('Unique constraint failed');

      if (isUnique) {
        const raced = await prisma.job.findFirst({
          where: {
            projectId,
            type: JobType.SCRIPT_GENERATION,
            idempotencyKey,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (raced) {
          const existingScript = await prisma.script.findFirst({
            where: { projectId, jobId: raced.id },
            orderBy: { createdAt: 'desc' },
          });

          return NextResponse.json(
            {
              jobId: raced.id,
              scriptId: existingScript?.id ?? null,
              script: existingScript ?? null,
              reused: true,
            },
            { status: 200 },
          );
        }

        return NextResponse.json(
          { jobId: null, reused: true },
          { status: 200 },
        );
      }
      throw e;
    }

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found after creation' },
        { status: 500 },
      );
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

    const stateResult = await runWithState(jobId, async () => {
      const freshJob = await prisma.job.findUnique({ where: { id: jobId } });
      if (!freshJob) {
        throw new Error('Job not found');
      }
      return startScriptGenerationJob(projectId, freshJob);
    });

    return NextResponse.json(
      { jobId, ...stateResult },
      { status: stateResult.ok ? 200 : 500 },
    );
  } catch (err: any) {
    console.error('script-generation POST failed', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
