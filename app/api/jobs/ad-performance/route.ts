// app/api/jobs/ad-performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startAdRawCollectionJob } from '@/lib/adRawCollectionService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';
import { enforcePlanLimits, incrementUsage } from '@/lib/billing';
import { logAudit } from '@/lib/logger';
import { getSessionUser } from '@/lib/getSessionUser';
import { createJobWithIdempotency, enforceUserConcurrency } from '@/lib/jobGuards';
import { JobType } from '@prisma/client';

const AdPerformanceSchema = ProjectJobSchema.extend({
  industryCode: z.string().min(1, 'industryCode is required'),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, AdPerformanceSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId: parsedProjectId, industryCode } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const userId = auth.user?.id ?? user.id;
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

    const rateCheck = await checkRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded: ${rateCheck.reason}` },
        { status: 429 },
      );
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.AD_PERFORMANCE,
      industryCode,
    ]);
    const { job, reused } = await createJobWithIdempotency({
      projectId,
      type: JobType.AD_PERFORMANCE,
      idempotencyKey,
      payload: { projectId, industryCode },
    });
    jobId = job.id;

    if (reused) {
      return NextResponse.json({ jobId: job.id, reused: true }, { status: 200 });
    }

    const result = await startAdRawCollectionJob({
      projectId,
      industryCode,
      jobId: job.id,
    });

    await logAudit({
      userId: user?.id ?? null,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'ad-performance',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    await logAudit({
      userId: user?.id ?? null,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'ad-performance',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Ad performance collection failed' },
      { status: 500 },
    );
  }
}
