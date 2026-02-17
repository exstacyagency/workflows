// app/api/jobs/script-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { startScriptGenerationJob } from "../../../../lib/scriptGenerationService";
import { requireProjectOwner } from "../../../../lib/requireProjectOwner";
import { ProjectJobSchema, parseJson } from "../../../../lib/validation/jobs";
import { checkRateLimit } from "../../../../lib/rateLimiter";
import { prisma } from "../../../../lib/prisma";
import { JobStatus, JobType, ScriptStatus, Prisma } from "@prisma/client";
import { logAudit } from "../../../../lib/logger";
import { getSessionUserId } from "../../../../lib/getSessionUserId";
import { enforceUserConcurrency } from "../../../../lib/jobGuards";
import { runWithState } from "../../../../lib/jobRuntime";
import { flag } from "../../../../lib/flags";
import { getRequestId, logError, logInfo } from "../../../../lib/observability";
import { z } from "zod";
import {
  assertMinPlan,
  UpgradeRequiredError,
} from "../../../../lib/billing/requirePlan";
import {
  reserveQuota,
  rollbackQuota,
  QuotaExceededError,
} from "../../../../lib/billing/usage";

const ScriptGenerationSchema = ProjectJobSchema.extend({
  runId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  logInfo("api.request", { requestId, path: req.nextUrl?.pathname });

  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";

  let reservation:
    | { periodKey: string; metric: string; amount: number }
    | null = null;
  let userIdForQuota: string | null = null;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userIdForQuota = userId;

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const parsed = await parseJson(req, ScriptGenerationSchema);
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
      return NextResponse.json(
        { error: "Billing check failed" },
        { status: 500 },
      );
    }

    const devTest = flag("FF_DEV_TEST_MODE");
    if (!securitySweep && !devTest) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json(
          { error: concurrency.reason },
          { status: 429 },
        );
      }
    }

    const normalizedRequestedRunId = String(parsed.data.runId ?? "").trim();
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
    console.log("[script-generation] run resolution", {
      payloadRunId: normalizedRequestedRunId || null,
      existingRunFound,
      attachedRunId: effectiveRunId,
    });

    const breakerTest = flag("FF_BREAKER_TEST");
    const selectedCustomerAnalysisJobId =
      typeof parsed.data.customerAnalysisJobId === "string"
        ? parsed.data.customerAnalysisJobId
        : "latest";
    const selectedProductId =
      typeof parsed.data.productId === "string"
        ? parsed.data.productId
        : "none";
    let idempotencyKey = `script-generation:${projectId}:${effectiveRunId}:${selectedProductId}:${selectedCustomerAnalysisJobId}`;
    if (breakerTest) idempotencyKey += `:${Date.now()}`;
    const bypassFailedIdempotencyRecord = async (jobId: string) => {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          idempotencyKey: `${idempotencyKey}:failed:${jobId}`,
        },
      });
    };

    const existingJob = await prisma.job.findFirst({
      where: { projectId, userId, idempotencyKey },
      select: { id: true, status: true, runId: true },
    });

    if (existingJob) {
      if (securitySweep) {
        if (existingJob.status !== JobStatus.COMPLETED) {
          await prisma.job.update({
            where: { id: existingJob.id },
            data: {
              status: JobStatus.COMPLETED,
              resultSummary: "Skipped: SECURITY_SWEEP",
              error: Prisma.JsonNull,
            },
          });
        }
        return NextResponse.json(
          {
            jobId: existingJob.id,
            runId: existingJob.runId ?? effectiveRunId,
            reused: true,
            started: false,
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          { status: 200 },
        );
      }
      if (existingJob.status === JobStatus.FAILED) {
        await bypassFailedIdempotencyRecord(existingJob.id);
      } else {
        return NextResponse.json(
          {
            jobId: existingJob.id,
            runId: existingJob.runId ?? effectiveRunId,
            ok: existingJob.status === JobStatus.COMPLETED,
          },
          { status: 200 },
        );
      }
    }

    // SECURITY_SWEEP short-circuit
    if (securitySweep) {
      try {
        reservation = await reserveQuota(userId, planId, "researchQueries", 1);
      } catch (err: any) {
        if (err instanceof QuotaExceededError) {
          return NextResponse.json(
            {
              error: "Quota exceeded",
              metric: "researchQueries",
              limit: err.limit,
              used: err.used,
            },
            { status: 429 },
          );
        }
        throw err;
      }

      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.SCRIPT_GENERATION,
          status: JobStatus.COMPLETED,
          idempotencyKey,
          runId: effectiveRunId,
          payload: {
            ...parsed.data,
            runId: effectiveRunId,
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
        select: { id: true },
      });

      await logAudit({
        userId,
        projectId,
        jobId: job.id,
        action: "job.create",
        ip,
        metadata: {
          type: "script-generation",
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
      });

      return NextResponse.json(
        {
          jobId: job.id,
          runId: effectiveRunId,
          started: false,
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
        { status: 200 },
      );
    }

    const isCI = cfg.raw("CI") === "true";
    const hasAnthropic = !!cfg.raw("ANTHROPIC_API_KEY");

    // CI fallback (NO VIDEO FIELDS)
    if (isCI && !hasAnthropic) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });

      const productName = project?.name ?? "Your product";
      const text = `Meet ${productName}. This script was generated in CI mode.`;
      const wordCount = text.split(/\s+/).length;

      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.SCRIPT_GENERATION,
          status: JobStatus.COMPLETED,
          idempotencyKey,
          runId: effectiveRunId,
          payload: {
            ...parsed.data,
            runId: effectiveRunId,
            skipped: true,
          },
          resultSummary: "Skipped: LLM not configured",
        },
      });

      const script = await prisma.script.create({
        data: {
          projectId,
          jobId: job.id,
          status: ScriptStatus.seeded,
          wordCount,
          rawJson: {
            text,
            skipped: true,
            reason: "LLM not configured",
          } as any,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          jobId: job.id,
          runId: effectiveRunId,
          scripts: [{ id: script.id, text }],
        },
        { status: 200 },
      );
    }

    if (!devTest && !cfg.raw("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "Anthropic is not configured" },
        { status: 500 },
      );
    }

    if (!devTest && cfg.raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    reservation = await reserveQuota(userId, planId, "researchQueries", 1);

    const createScriptGenerationJob = () =>
      prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.SCRIPT_GENERATION,
          status: JobStatus.RUNNING,
          idempotencyKey,
          runId: effectiveRunId,
          payload: {
            ...parsed.data,
            runId: effectiveRunId,
          },
        },
      });

    let job;
    try {
      job = await createScriptGenerationJob();
    } catch (err: any) {
      if (err?.code === "P2002") {
        const existing = await prisma.job.findFirst({
          where: { projectId, userId, idempotencyKey },
          select: { id: true, status: true, runId: true },
        });

        if (existing) {
          if (existing.status === JobStatus.FAILED) {
            await bypassFailedIdempotencyRecord(existing.id);
            job = await createScriptGenerationJob();
          } else {
            if (reservation && userIdForQuota) {
              await rollbackQuota(
                userIdForQuota,
                reservation.periodKey,
                "researchQueries",
                1,
              );
            }
            return NextResponse.json(
              {
                jobId: existing.id,
                runId: existing.runId ?? effectiveRunId,
                ok: existing.status === JobStatus.COMPLETED,
              },
              { status: 200 },
            );
          }
        }
      }
      if (!job) {
        throw err;
      }
    }

    await logAudit({
      userId,
      projectId,
      jobId: job.id,
      action: "job.create",
      ip,
      metadata: { type: "script-generation" },
    });

    const state = await runWithState(job.id, () =>
      startScriptGenerationJob(projectId, job),
    );

    if (!state.ok && reservation) {
      await rollbackQuota(userId, reservation.periodKey, "researchQueries", 1);
    }

    return NextResponse.json(
      { jobId: job.id, runId: effectiveRunId, ...state },
      { status: state.ok ? 200 : 500 },
    );
  } catch (err: any) {
    if (reservation && userIdForQuota) {
      await rollbackQuota(
        userIdForQuota,
        reservation.periodKey,
        "researchQueries",
        1,
      );
    }

    logError("api.error", err, { requestId });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
