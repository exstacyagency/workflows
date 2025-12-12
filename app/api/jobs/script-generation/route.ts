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

    const idempotencyKey = `script-generation:${projectId}`;

    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Job"
      WHERE "projectId" = ${projectId}
        AND "type" = CAST(${JobType.SCRIPT_GENERATION} AS "JobType")
        AND "idempotencyKey" = ${idempotencyKey}
        AND "status" IN (
          CAST('PENDING' AS "JobStatus"),
          CAST('RUNNING' AS "JobStatus")
        )
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    if (existing.length) {
      const existingJobId = existing[0].id;
      const existingScript = await prisma.script.findFirst({
        where: {
          projectId,
          jobId: existingJobId,
        },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json(
        {
          jobId: existingJobId,
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

    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const payloadJson = JSON.stringify({ idempotencyKey });
    const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Job" ("type","status","projectId","idempotencyKey","payload","createdAt","updatedAt")
      VALUES (
        CAST(${JobType.SCRIPT_GENERATION} AS "JobType"),
        CAST('RUNNING' AS "JobStatus"),
        ${projectId},
        ${idempotencyKey},
        CAST(${payloadJson} AS jsonb),
        now(),
        now()
      )
      ON CONFLICT ("projectId","type","idempotencyKey")
      DO UPDATE SET "updatedAt" = now()
      RETURNING "id"
    `;

    const jobId = inserted[0]?.id;
    if (!jobId) {
      throw new Error('Failed to create script-generation job');
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new Error('Job not found after creation');
    }

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
    console.error('script-generation POST failed', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
