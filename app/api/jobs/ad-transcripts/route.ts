// app/api/jobs/ad-transcripts/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { startAdTranscriptJob } from '../../../../lib/adTranscriptCollectionService';
import { prisma } from '../../../../lib/prisma';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    const parsed = await parseJson(req, ProjectJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    projectId = parsed.data.projectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Plan check AFTER ownership to avoid leaking project existence via 402.
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

    // SECURITY_SWEEP should never be blocked by concurrency.
    // Concurrency is meant to protect real vendor work, not deterministic placeholders.
    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    const idempotencyKey = JSON.stringify([projectId, JobType.AD_TRANSCRIPTS, 'transcript']);
    const existing = await findIdempotentJob({
      projectId,
      type: JobType.AD_TRANSCRIPTS,
      idempotencyKey,
    });
    if (existing) {
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
    }

    // Quota must ALWAYS apply. SECURITY_SWEEP must not be a billing bypass.
    try {
      reservation = await reserveQuota(userId, planId, 'researchQueries', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    // SECURITY_SWEEP: never touch vendors. Return deterministic placeholder.
    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          type: JobType.AD_TRANSCRIPTS,
          status: JobStatus.PENDING,
          payload: parsed.data,
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: null,
        },
        select: { id: true },
      });
      jobId = job.id;
      await logAudit({
        userId,
        projectId,
        jobId,
        action: "job.create",
        ip,
        metadata: { type: "ad-transcripts", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
      );
    }

    // Vendor checks MUST be after sweep short-circuit
    if (!cfg.raw("ASSEMBLYAI_API_KEY")) {
      return NextResponse.json(
        { error: "ASSEMBLYAI: ASSEMBLYAI_API_KEY must be set in .env" },
        { status: 500 },
      );
    }

    if (cfg.raw("NODE_ENV") === 'production') {
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
        type: JobType.AD_TRANSCRIPTS,
        status: JobStatus.PENDING,
        payload: { projectId, kind: 'ad_transcript_collection', idempotencyKey },
      },
    });
    jobId = job.id;

    const result = await startAdTranscriptJob({ projectId, jobId: job.id });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'ad-transcripts',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (reservation) {
      await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'ad-transcripts',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Ad transcript job failed' },
      { status: 500 },
    );
  }
}
