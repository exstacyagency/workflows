// app/api/jobs/script-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startScriptGenerationJob } from '../../../../lib/scriptGenerationService';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '../../../../lib/validation/jobs';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { prisma } from '../../../../lib/prisma';
import { JobStatus, JobType } from '@prisma/client';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency } from '../../../../lib/jobGuards';
import { runWithState } from '../../../../lib/jobRuntime';
import { flag } from "../../../../lib/flags";
import { getRequestId, logError, logInfo } from "../../../../lib/observability";
import { assertMinPlan, UpgradeRequiredError } from "../../../../lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "../../../../lib/billing/usage";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  logInfo("api.request", { requestId, path: req.nextUrl?.pathname });

  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  let userIdForQuota: string | null = null;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userIdForQuota = userId;
    let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";
    try {
      planId = await assertMinPlan(userId, "GROWTH");
    } catch (err: any) {
      if (err instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { error: "Upgrade required", requiredPlan: err.requiredPlan },
          { status: 402 },
        );
      }
      console.error(err);
      return NextResponse.json({ error: "Billing check failed" }, { status: 500 });
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

    const devTest = flag("FF_DEV_TEST_MODE");
    const breakerTest = flag("FF_BREAKER_TEST");
    let idempotencyKey = `script-generation:${projectId}`;
    if (breakerTest) {
      idempotencyKey = `${idempotencyKey}:${Date.now()}`;
    }

    const isCIOrTest = process.env.CI === "true" || process.env.NODE_ENV === "test";
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    if (isCIOrTest && !hasAnthropic) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Anthropic not configured" },
        { status: 200 },
      );
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
      if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json(
          { error: 'Anthropic is not configured' },
          { status: 500 },
        );
      }
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

    let jobId: string | null = null;
    let createdNew = false;

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
      jobId = existingJob.id;
    }

    if (!jobId) {
      if (!devTest) {
        try {
          reservation = await reserveQuota(userId, planId, "researchQueries", 1);
        } catch (err: any) {
          if (err instanceof QuotaExceededError) {
            return NextResponse.json(
              { error: "Quota exceeded", metric: "researchQueries", limit: err.limit, used: err.used },
              { status: 429 },
            );
          }
          throw err;
        }
      }

      try {
        const job = await prisma.job.create({
          data: {
            projectId,
            type: JobType.SCRIPT_GENERATION,
            status: JobStatus.RUNNING,
            idempotencyKey,
            payload: { ...parsed.data, idempotencyKey },
          },
        });
        jobId = job.id;
        createdNew = true;
      } catch (e: any) {
        const message = String(e?.message ?? '');
        const isUnique =
          e?.code === 'P2002' ||
          (e?.name === 'PrismaClientKnownRequestError' && e?.meta?.target) ||
          message.includes('Unique constraint failed');

        if (isUnique) {
          if (!devTest && reservation) {
            await rollbackQuota(userId, reservation.periodKey, "researchQueries", 1);
            reservation = null;
          }
          const raced = await prisma.job.findFirst({
            where: {
              projectId,
              type: JobType.SCRIPT_GENERATION,
              idempotencyKey,
            },
            orderBy: { createdAt: 'desc' },
          });

          if (raced) {
            jobId = raced.id;
          } else {
            return NextResponse.json(
              { error: 'Failed to resolve job after unique constraint' },
              { status: 500 },
            );
          }
        } else {
          throw e;
        }
      }
    }

    if (!jobId) {
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

    console.log("[script-generation] entering runWithState", { jobId, projectId });
    const state = await runWithState(jobId, async () => {
      const freshJob = await prisma.job.findUnique({ where: { id: jobId } });
      if (!freshJob) {
        throw new Error('Job not found');
      }
      return startScriptGenerationJob(projectId, freshJob);
    });
    console.log("[script-generation] runWithState result", state);

    if (!devTest && createdNew && reservation && !state.ok) {
      await rollbackQuota(userId, reservation.periodKey, "researchQueries", 1);
      reservation = null;
    }

    return NextResponse.json(
      { jobId, ...state },
      { status: state.ok ? 200 : 500 },
    );
  } catch (err: any) {
    if (reservation && userIdForQuota) {
      await rollbackQuota(userIdForQuota, reservation.periodKey, "researchQueries", 1);
    }
    logError("api.error", err, { requestId, path: req.nextUrl?.pathname });
    console.error('script-generation POST failed', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
