import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { JobStatus, JobType } from "@prisma/client";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { ProjectJobSchema, parseJson } from "@/lib/validation/jobs";
import { checkRateLimit } from "@/lib/rateLimiter";
import { logAudit } from "@/lib/logger";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { enforceUserConcurrency } from "@/lib/jobGuards";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import { reserveQuota, rollbackQuota, QuotaExceededError } from "@/lib/billing/usage";
import { getAdDataCompleteness } from "@/lib/patternAnalysisService";
import { randomUUID } from "crypto";
import { z } from "zod";

const PatternAnalysisSchema = ProjectJobSchema.extend({
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
  let didReserveQuota = false;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";

  try {
    const parsed = await parseJson(req, PatternAnalysisSchema);
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
      return NextResponse.json({ error: "Billing check failed" }, { status: 500 });
    }

    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json({ error: concurrency.reason }, { status: 429 });
      }
    }

    const normalizedRequestedRunId = String(runId ?? "").trim();
    let effectiveRunId = normalizedRequestedRunId || undefined;
    let existingRunFound = false;
    if (effectiveRunId) {
      const existingRun = await prisma.researchRun.findUnique({
        where: { id: effectiveRunId },
        select: { id: true, projectId: true },
      });
      if (!existingRun) {
        return NextResponse.json(
          { error: "runId not found for this project" },
          { status: 400 }
        );
      }
      if (existingRun.projectId !== projectId) {
        return NextResponse.json(
          { error: "runId does not belong to this project" },
          { status: 400 }
        );
      }
      existingRunFound = true;
    } else {
      const latestAdCollection = await prisma.job.findFirst({
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
      effectiveRunId = latestAdCollection?.runId ?? undefined;
    }
    console.log("[pattern-analysis] run resolution", {
      payloadRunId: normalizedRequestedRunId || null,
      existingRunFound,
      attachedRunId: effectiveRunId ?? null,
    });

    if (!effectiveRunId) {
      return NextResponse.json(
        { error: "No completed ad collection found. Run ad collection first." },
        { status: 400 }
      );
    }

    if (!cfg.raw("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const completeness = await getAdDataCompleteness({
      projectId,
      runId: effectiveRunId,
    });

    if (!completeness.canRun) {
      return NextResponse.json(
        {
          error: completeness.reason ?? "Pattern analysis requirements not met",
          completeness,
        },
        { status: 400 }
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
      jobType: "ad_pattern_analysis",
      idempotencyKey,
    };

    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.PATTERN_ANALYSIS,
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
        metadata: { type: "pattern-analysis", skipped: true, reason: "SECURITY_SWEEP" },
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
        type: JobType.PATTERN_ANALYSIS,
        status: JobStatus.PENDING,
        idempotencyKey,
        runId: effectiveRunId,
        payload,
      },
    });
    jobId = job.id;

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.create",
      ip,
      metadata: {
        type: "pattern-analysis",
        runId: effectiveRunId,
      },
    });

    return NextResponse.json(
      { jobId, runId: effectiveRunId, started: true },
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
        type: "pattern-analysis",
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
}
