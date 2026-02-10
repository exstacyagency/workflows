// app/api/jobs/ad-transcripts/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { startAdTranscriptJob } from "@/lib/adTranscriptCollectionService";
import { prisma } from "@/lib/prisma";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { ProjectJobSchema, parseJson } from "@/lib/validation/jobs";
import { checkRateLimit } from "@/lib/rateLimiter";
import { logAudit } from "@/lib/logger";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { enforceUserConcurrency, findIdempotentJob } from "@/lib/jobGuards";
import { JobStatus, JobType } from "@prisma/client";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "@/lib/billing/usage";
import { randomUUID } from 'crypto';
import { z } from 'zod';

const JOB_TYPE = JobType.AD_PERFORMANCE; // enum-safe, schema-backed

const AdTranscriptsSchema = ProjectJobSchema.extend({
  runId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation:
    | { periodKey: string; metric: string; amount: number }
    | null = null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";

  try {
    const parsed = await parseJson(req, AdTranscriptsSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }

    const { projectId: parsedProjectId, runId, productId } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
      planId = await assertMinPlan(userId, "GROWTH");
    } catch (err) {
      if (err instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { error: "Upgrade required", requiredPlan: err.requiredPlan },
          { status: 402 }
        );
      }
      throw err;
    }

    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 }
        );
      }
    }

    // Get runId from request or find most recent completed ad collection job
    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const latestCollection = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.AD_PERFORMANCE,
          status: JobStatus.COMPLETED,
          runId: { not: null },
          payload: {
            path: ['jobType'],
            equals: 'ad_raw_collection',
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { runId: true },
      });
      effectiveRunId = latestCollection?.runId ?? undefined;
    }

    if (!effectiveRunId) {
      return NextResponse.json(
        { error: 'No completed ad collection job found. Please run ad collection first.' },
        { status: 400 }
      );
    }

    const idempotencyKey = randomUUID();

    try {
      reservation = await reserveQuota(userId, planId, "researchQueries", 1);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          {
            error: "Quota exceeded",
            metric: "researchQueries",
            limit: err.limit,
            used: err.used,
          },
          { status: 429 }
        );
      }
      throw err;
    }

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JOB_TYPE,
          status: JobStatus.PENDING,
          idempotencyKey,
          payload: parsed.data,
          resultSummary: "Skipped: SECURITY_SWEEP",
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
        metadata: {
          type: "ad-transcripts",
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
      });

      return NextResponse.json(
        { jobId, started: false, skipped: true },
        { status: 200 }
      );
    }

    if (!cfg.raw("APIFY_API_TOKEN")) {
      return NextResponse.json(
        { error: "APIFY_API_TOKEN must be set" },
        { status: 500 }
      );
    }

    if (cfg.raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 }
        );
      }
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JOB_TYPE,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload: {
          projectId,
          ...(productId ? { productId } : {}),
          kind: "ad_transcript_collection",
          idempotencyKey,
        },
      },
    });

    jobId = job.id;

    const result = await startAdTranscriptJob({
      projectId,
      jobId: job.id,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.create",
      ip,
      metadata: { type: "ad-transcripts" },
    });

    return NextResponse.json({ ...result, runId: effectiveRunId }, { status: 200 });
  } catch (err: any) {
    console.error(err);

    if (reservation && userId) {
      await rollbackQuota(userId, reservation.periodKey, "researchQueries", 1);
    }

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.error",
      ip,
      metadata: {
        type: "ad-transcripts",
        error: String(err?.message ?? err),
      },
    });

    return NextResponse.json(
      { error: err?.message ?? "Ad transcript job failed" },
      { status: 500 }
    );
  }
}
