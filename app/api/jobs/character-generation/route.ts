// app/api/jobs/character-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startCharacterGenerationJob } from '../../../../lib/characterGenerationService';
import { prisma } from '../../../../lib/prisma';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

const CharacterGenerationSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, 'productName is required'),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    planId = await assertMinPlan(userId, 'GROWTH');
  } catch (err: any) {
    if (err instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: 'Upgrade required', requiredPlan: err.requiredPlan },
        { status: 402 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: 'Billing check failed' }, { status: 500 });
  }

  try {
    const parsed = await parseJson(req, CharacterGenerationSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId: parsedProjectId, productName } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      const isCIOrTest =
        process.env.CI === 'true' || process.env.NODE_ENV === 'test';
      if (isCIOrTest) {
        return NextResponse.json(
          { ok: true, skipped: true, reason: 'Anthropic not configured' },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { error: 'Anthropic is not configured' },
        { status: 500 },
      );
    }

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.reason },
        { status: 429 },
      );
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.CHARACTER_GENERATION,
      productName,
    ]);
    const existing = await findIdempotentJob({
      projectId,
      type: JobType.CHARACTER_GENERATION,
      idempotencyKey,
    });
    if (existing) {
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
    }

    try {
      reservation = await reserveQuota(userId, planId, 'imageJobs', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'imageJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }
    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        type: JobType.CHARACTER_GENERATION,
        status: JobStatus.PENDING,
        payload: { projectId, productName, idempotencyKey },
      },
    });
    jobId = job.id;

    const result = await startCharacterGenerationJob({
      projectId,
      productName,
      jobId,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'character-generation',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (reservation) {
      await rollbackQuota(userId, reservation.periodKey, 'imageJobs', 1);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'character-generation',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Character generation failed' },
      { status: 500 },
    );
  }
}
