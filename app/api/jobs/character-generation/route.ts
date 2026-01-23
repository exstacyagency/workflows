// app/api/jobs/character-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { startCharacterGenerationJob } from "@/lib/characterGenerationService";
import { prisma } from "@/lib/prisma";
import { requireProjectOwner } from "@/lib/requireProjectOwner";
import { ProjectJobSchema, parseJson } from "@/lib/validation/jobs";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimiter";
import { logAudit } from "@/lib/logger";
import { getSessionUserId } from "@/lib/getSessionUserId";
import { enforceUserConcurrency, findIdempotentJob } from "@/lib/jobGuards";
import { JobStatus, JobType } from "@prisma/client";
import { assertMinPlan, UpgradeRequiredError } from "@/lib/billing/requirePlan";
import {
  reserveQuota,
  rollbackQuota,
  QuotaExceededError,
} from "@/lib/billing/usage";

const JOB_TYPE = JobType.VIDEO_GENERATION; // enum-safe

const CharacterGenerationSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, "productName is required"),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const securitySweep = cfg().raw("SECURITY_SWEEP") === "1";
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation:
    | { periodKey: string; metric: string; amount: number }
    | null = null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let planId: "FREE" | "GROWTH" | "SCALE" = "FREE";

  try {
    planId = await assertMinPlan(userId, "GROWTH");
  } catch (err) {
    if (err instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: "Upgrade required", requiredPlan: err.requiredPlan },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: "Billing check failed" },
      { status: 500 }
    );
  }

  try {
    const parsed = await parseJson(req, CharacterGenerationSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 }
      );
    }

    const { projectId: parsedProjectId, productName } = parsed.data;
    projectId = parsedProjectId;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!securitySweep && !cfg().raw("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "Anthropic is not configured" },
        { status: 500 }
      );
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

    const idempotencyKey = JSON.stringify([
      projectId,
      JOB_TYPE,
      "character-generation",
      productName,
    ]);

    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JOB_TYPE,
      idempotencyKey,
    });

    if (existing) {
      return NextResponse.json(
        {
          jobId: existing.id,
          reused: true,
          ...(securitySweep
            ? { started: false, skipped: true, reason: "SECURITY_SWEEP" }
            : {}),
        },
        { status: 200 }
      );
    }

    try {
      reservation = await reserveQuota(userId, planId, "imageJobs", 1);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          {
            error: "Quota exceeded",
            metric: "imageJobs",
            limit: err.limit,
            used: err.used,
          },
          { status: 429 }
        );
      }
      throw err;
    }

    const customerAvatar = await prisma.customerAvatar.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!customerAvatar && !securitySweep) {
      return NextResponse.json(
        {
          error:
            "Prerequisite missing: CustomerAvatar. Run Customer Analysis first.",
        },
        { status: 409 }
      );
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JOB_TYPE,
        status: JobStatus.PENDING,
        idempotencyKey,
        payload: {
          projectId,
          productName,
          kind: "character_generation",
          idempotencyKey,
        },
        resultSummary: securitySweep ? "Skipped: SECURITY_SWEEP" : undefined,
      },
      select: { id: true },
    });

    jobId = job.id;

    if (securitySweep) {
      return NextResponse.json(
        { ok: true, jobId, started: false, skipped: true },
        { status: 200 }
      );
    }

    if (cfg().raw("NODE_ENV") === "production") {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 }
        );
      }
    }

    const result = await startCharacterGenerationJob({
      projectId,
      productName,
      jobId,
    });

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.create",
      ip,
      metadata: { type: "character-generation" },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);

    if (reservation && userId) {
      await rollbackQuota(userId, reservation.periodKey, "imageJobs", 1);
    }

    await logAudit({
      userId,
      projectId,
      jobId,
      action: "job.error",
      ip,
      metadata: {
        type: "character-generation",
        error: String(err?.message ?? err),
      },
    });

    return NextResponse.json(
      { error: err?.message ?? "Character generation failed" },
      { status: 500 }
    );
  }
}