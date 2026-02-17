// app/api/jobs/ad-collection/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from '@prisma/client';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUserId } from '@/lib/getSessionUserId';
import { enforceUserConcurrency } from '@/lib/jobGuards';
import { assertMinPlan, UpgradeRequiredError } from '@/lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '@/lib/billing/usage';
import { randomUUID } from 'crypto';
import { buildAdCollectionConfig } from '@/lib/adRawCollectionService';

const AdCollectionSchema = ProjectJobSchema.extend({
  industryCode: z.string().optional(),
  runId: z.string().optional(),
});

const DEFAULT_TIKTOK_INDUSTRY_CODE = (cfg.raw("APIFY_DEFAULT_INDUSTRY_CODE") ?? "23000000000").trim();
const TIKTOK_INDUSTRY_CODE_PATTERN = /^\d{11}$/;

function resolveIndustryCode(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || DEFAULT_TIKTOK_INDUSTRY_CODE;
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let didReserveQuota = false;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    const parsed = await parseJson(req, AdCollectionSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }

    const {
      projectId: parsedProjectId,
      productId,
      industryCode: rawIndustryCode,
      runId,
    } = parsed.data;
    projectId = parsedProjectId;
    const industryCode = resolveIndustryCode(rawIndustryCode);
    if (!TIKTOK_INDUSTRY_CODE_PATTERN.test(industryCode)) {
      return NextResponse.json(
        {
          error:
            "Invalid industryCode. Expected TikTok Creative Center industry ID (11 digits), e.g. 23116000000.",
        },
        { status: 400 },
      );
    }

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
      planId = await assertMinPlan(userId, 'FREE');
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

    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    const normalizedRequestedRunId = String(runId ?? "").trim();
    let effectiveRunId = normalizedRequestedRunId;
    let existingRunFound = false;
    if (effectiveRunId) {
      const existingRun = await prisma.researchRun.findUnique({
        where: { id: effectiveRunId },
        select: { id: true, projectId: true },
      });
      if (!existingRun) {
        return NextResponse.json(
          { error: "runId not found for this project" },
          { status: 400 },
        );
      }
      if (existingRun.projectId !== projectId) {
        return NextResponse.json(
          { error: "runId does not belong to this project" },
          { status: 400 },
        );
      }
      existingRunFound = true;
    } else {
      const run = await prisma.researchRun.create({
        data: {
          projectId,
          status: "IN_PROGRESS",
        },
      });
      effectiveRunId = run.id;
    }
    console.log("[ad-collection] run resolution", {
      payloadRunId: normalizedRequestedRunId || null,
      existingRunFound,
      attachedRunId: effectiveRunId,
    });

    const existingActiveJob = await prisma.job.findFirst({
      where: {
        projectId,
        userId,
        type: JobType.AD_PERFORMANCE,
        runId: effectiveRunId,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        payload: {
          path: ["jobType"],
          equals: "ad_raw_collection",
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existingActiveJob) {
      return NextResponse.json(
        {
          jobId: existingActiveJob.id,
          runId: effectiveRunId,
          started: false,
          reused: true,
          status: existingActiveJob.status,
        },
        { status: 200 },
      );
    }

    const idempotencyKey = randomUUID();
    const apifyConfig = buildAdCollectionConfig(industryCode);
    const payloadBase = {
      projectId,
      ...(productId ? { productId } : {}),
      runId: effectiveRunId,
      industryCode,
      jobType: "ad_raw_collection",
      adCollectionConfig: apifyConfig,
    };

    try {
      await reserveQuota(userId, planId, 'adCollectionJobs', 1);
      didReserveQuota = true;
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'adCollectionJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.AD_PERFORMANCE,
          status: JobStatus.PENDING,
          idempotencyKey,
          runId: effectiveRunId,
          payload: { ...payloadBase, idempotencyKey },
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
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
        metadata: { type: "ad-collection", skipped: true, reason: "SECURITY_SWEEP" },
      });
      return NextResponse.json(
        { jobId, runId: effectiveRunId, started: false, skipped: true, reason: "SECURITY_SWEEP" },
        { status: 200 },
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
        userId,
        type: JobType.AD_PERFORMANCE,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload: { ...payloadBase, idempotencyKey },
      },
    });
    jobId = job.id;

    // Job will be picked up by jobRunner worker (no queue needed)

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'ad-collection',
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: true },
      { status: 202 },
    );
  } catch (err: any) {
    if (didReserveQuota) {
      const periodKey = new Date().toISOString().slice(0, 7);
      await rollbackQuota(userId, periodKey, 'adCollectionJobs', 1).catch(console.error);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'ad-collection',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }
}
