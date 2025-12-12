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
    const devTest = process.env.FF_DEV_TEST_MODE === 'true';
    const idempotencyKey = `script-generation:${projectId}`;

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Job_projectId_type_idempotencyKey_key"
      ON "Job" ("projectId","type","idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL;
    `);

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

    let jobId: string | null = existing[0]?.id ?? null;

    if (!jobId) {
      const payloadJson = JSON.stringify({ idempotencyKey });
      const typeVal = JobType.SCRIPT_GENERATION;
      const statusVal = JobStatus.RUNNING;
      const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Job" ("type","status","projectId","idempotencyKey","payload","createdAt","updatedAt")
        VALUES (
          CAST(${typeVal} AS "JobType"),
          CAST(${statusVal} AS "JobStatus"),
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
      jobId = inserted[0]?.id ?? null;
    }

    if (!jobId) {
      return NextResponse.json(
        { error: 'Failed to create or reuse script-generation job' },
        { status: 500 },
      );
    }

    const existingScript = await prisma.script.findFirst({
      where: {
        projectId,
        jobId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingScript) {
      return NextResponse.json(
        {
          jobId,
          scriptId: existingScript.id,
          script: existingScript,
          reused: true,
        },
        { status: 200 },
      );
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found after creation' },
        { status: 500 },
      );
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

    return NextResponse.json({ ...result, jobId }, { status: 200 });
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
