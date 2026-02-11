import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, JobStatus, JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { ProjectJobSchema, parseJson } from "@/lib/validation/jobs";
import { checkRateLimit } from "@/lib/rateLimiter";
import { logAudit } from "@/lib/logger";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { enforceUserConcurrency } from "@/lib/jobGuards";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "@/lib/billing/usage";
import { randomUUID } from "crypto";
import { z } from "zod";

const AdQualityGateSchema = ProjectJobSchema.extend({
  runId: z.string().optional(),
  forceReprocess: z.boolean().optional(),
});
const JOB_TYPE_AD_QUALITY_GATE = "AD_QUALITY_GATE" as JobType;

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let didReserveQuota = false;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";

  try {
    const debugPayload = await req.clone().json().catch(() => null);
    console.log("Received:", debugPayload);

    const parsed = await parseJson(req, AdQualityGateSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }

    const {
      projectId: parsedProjectId,
      runId,
      productId,
      forceReprocess: rawForceReprocess,
    } = parsed.data;
    projectId = parsedProjectId;
    const forceReprocess = rawForceReprocess === true;

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
      return NextResponse.json({ error: "Billing check failed" }, { status: 500 });
    }

    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json({ error: concurrency.reason }, { status: 429 });
      }
    }

    let effectiveRunId = runId;
    if (!effectiveRunId) {
      const latestCollection = await prisma.job.findFirst({
        where: {
          projectId,
          type: JobType.AD_PERFORMANCE,
          status: JobStatus.COMPLETED,
          runId: { not: null },
          payload: {
            path: ["jobType"],
            equals: "ad_raw_collection",
          },
        },
        orderBy: { createdAt: "desc" },
        select: { runId: true },
      });
      effectiveRunId = latestCollection?.runId ?? undefined;
    }

    if (!effectiveRunId) {
      return NextResponse.json({ error: "No ads to process" }, { status: 400 });
    }

    if (!cfg.raw("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const existingActiveJob = await prisma.job.findFirst({
      where: {
        projectId,
        userId,
        type: JOB_TYPE_AD_QUALITY_GATE,
        runId: effectiveRunId,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
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
        { status: 200 }
      );
    }

    const idempotencyKey = randomUUID();

    try {
      await reserveQuota(userId, planId, "patternAnalysisJobs", 1);
      didReserveQuota = true;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          {
            error: "Quota exceeded",
            metric: "patternAnalysisJobs",
            limit: err.limit,
            used: err.used,
          },
          { status: 429 }
        );
      }
      throw err;
    }

    const payload = {
      projectId,
      runId: effectiveRunId,
      ...(productId ? { productId } : {}),
      jobType: "ad_quality_gate",
      forceReprocess,
      idempotencyKey,
    };

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JOB_TYPE_AD_QUALITY_GATE,
          status: JobStatus.PENDING,
          idempotencyKey,
          runId: effectiveRunId,
          payload,
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
        metadata: {
          type: "ad-quality-gate",
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
      });
      return NextResponse.json(
        { jobId, runId: effectiveRunId, started: false, skipped: true },
        { status: 200 }
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
        type: JOB_TYPE_AD_QUALITY_GATE,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload,
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
        type: "ad-quality-gate",
        runId: effectiveRunId,
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: true, forceReprocess },
      { status: 202 }
    );
  } catch (err: any) {
    if (didReserveQuota) {
      const periodKey = new Date().toISOString().slice(0, 7);
      await rollbackQuota(userId, periodKey, "patternAnalysisJobs", 1).catch(console.error);
    }

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.error",
      ip,
      metadata: {
        type: "ad-quality-gate",
        error: String(err?.message ?? err),
      },
    });

    return NextResponse.json(
      { error: err?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
}
