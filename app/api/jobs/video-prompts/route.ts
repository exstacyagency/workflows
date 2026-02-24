// app/api/jobs/video-prompts/route.ts
import { randomUUID } from "crypto";
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function resolveStoryboardIdFromJob(resultSummary: unknown, payload: unknown): string | null {
  const summaryObj = asObject(resultSummary);
  const payloadObj = asObject(payload);

  const fromSummary = asString(summaryObj?.storyboardId);
  if (fromSummary) return fromSummary;

  const nestedSummary = asObject(summaryObj?.summary);
  const nestedSummaryId = asString(nestedSummary?.storyboardId);
  if (nestedSummaryId) return nestedSummaryId;

  const fromPayload = asString(payloadObj?.storyboardId);
  if (fromPayload) return fromPayload;

  const summaryText = typeof resultSummary === "string" ? resultSummary : "";
  if (summaryText) {
    const match = summaryText.match(/storyboardId=([^) ,]+)/);
    if (match?.[1]) return String(match[1]).trim();
  }

  return null;
}

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
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body', details: 'Invalid JSON body' }, { status: 400 });
    }

    const BodySchema = z.object({
      storyboardId: z.string().min(1),
      productId: z.string().trim().min(1).max(200).optional(),
      characterHandle: z.string().trim().min(1).max(200).optional(),
      attemptKey: z.string().trim().min(1).max(200).optional(),
      runId: z.string().trim().min(1).max(200).optional(),
    });

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const requestedStoryboardId = parsed.data.storyboardId;
    const requestedProductId = parsed.data.productId ? String(parsed.data.productId).trim() : "";
    const requestedCharacterHandle = parsed.data.characterHandle
      ? String(parsed.data.characterHandle).trim()
      : "";
    const requestedRunId = parsed.data.runId ? String(parsed.data.runId).trim() : "";
    let effectiveProductId: string | null = null;
    let effectiveRunId: string | null = null;
    // Keep idempotency scoped to a single generation attempt.
    // If client does not supply attemptKey, generate a unique nonce per request.
    const attemptKey = parsed.data.attemptKey || `${Date.now()}-${randomUUID()}`;

    const requestedStoryboard = await prisma.storyboard.findUnique({
      where: { id: requestedStoryboardId },
      select: { id: true, projectId: true },
    });
    if (!requestedStoryboard) {
      return NextResponse.json(
        { error: 'Storyboard or project not found' },
        { status: 404 },
      );
    }
    projectId = requestedStoryboard.projectId;

    const deny = await requireProjectOwner404(projectId);
    if (deny) return deny;

    if (requestedRunId) {
      const run = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
        select: { id: true, projectId: true },
      });
      if (!run || run.projectId !== projectId) {
        return NextResponse.json({ error: "runId not found for this project" }, { status: 400 });
      }
      effectiveRunId = run.id;
    }

    if (requestedProductId) {
      const productRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "product"
        WHERE "id" = ${requestedProductId}
          AND "project_id" = ${projectId}
        LIMIT 1
      `;
      if (!productRows[0]?.id) {
        return NextResponse.json({ error: "productId not found for this project" }, { status: 400 });
      }
      effectiveProductId = requestedProductId;
    }

    const latestStoryboardJob = await prisma.job.findFirst({
      where: {
        projectId,
        userId,
        type: JobType.STORYBOARD_GENERATION,
        status: JobStatus.COMPLETED,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        resultSummary: true,
        payload: true,
      },
    });

    const resolvedStoryboardId =
      resolveStoryboardIdFromJob(latestStoryboardJob?.resultSummary, latestStoryboardJob?.payload) ||
      requestedStoryboardId;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: resolvedStoryboardId },
      select: {
        id: true,
        projectId: true,
        scriptId: true,
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: {
            id: true,
            sceneNumber: true,
            status: true,
            rawJson: true,
          },
        },
        script: {
          select: {
            rawJson: true,
            job: {
              select: {
                payload: true,
              },
            },
          },
        },
      },
    });
    if (!storyboard || storyboard.projectId !== projectId) {
      return NextResponse.json(
        { error: "No valid completed storyboard found for this run/project" },
        { status: 400 },
      );
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

    // SECURITY_SWEEP should not be blocked by concurrency. Concurrency is for real vendor work.
    if (!securitySweep) {
      const concurrency = await enforceUserConcurrency(userId);
      if (!concurrency.allowed) {
        return NextResponse.json({ error: concurrency.reason }, { status: 429 });
      }
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

    const scriptJobPayload = asObject(storyboard.script?.job?.payload) ?? {};
    const effectiveProductFromScript = asString(scriptJobPayload.productId) || null;
    const resolvedProductId = effectiveProductId ?? effectiveProductFromScript;
    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.VIDEO_PROMPT_GENERATION,
      storyboard.id,
      resolvedProductId ?? "no_product",
      effectiveRunId ?? "no_run",
      attemptKey,
    ]);
    const existing = await findIdempotentJob({
      userId,
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      idempotencyKey,
    });
    if (existing) {
      // Deterministic smoke semantics: reused jobs in SECURITY_SWEEP should still report skipped.
      if (securitySweep) {
        return NextResponse.json(
          {
            jobId: existing.id,
            runId: existing.runId ?? effectiveRunId,
            reused: true,
            started: false,
            skipped: true,
            reason: "SECURITY_SWEEP",
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { jobId: existing.id, runId: existing.runId ?? effectiveRunId, reused: true },
        { status: 200 },
      );
    }

    try {
      reservation = await reserveQuota(userId, planId, 'videoJobs', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'videoJobs', limit: err.limit, used: err.used },
          { status: 429 },
        );
      }
      throw err;
    }

    // SECURITY_SWEEP: after plan+quota, never call external/model services. Return deterministic placeholder.
    if (securitySweep) {
      const job = await prisma.job.create({
        data: {
          projectId,
          userId,
          type: JobType.VIDEO_PROMPT_GENERATION,
          status: JobStatus.PENDING,
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          payload: {
            storyboardId: storyboard.id,
            ...(storyboard.scriptId ? { scriptId: storyboard.scriptId } : {}),
            ...(resolvedProductId ? { productId: resolvedProductId } : {}),
            ...(requestedCharacterHandle ? { characterHandle: requestedCharacterHandle } : {}),
            idempotencyKey,
            ...(effectiveRunId ? { runId: effectiveRunId } : {}),
          },
          resultSummary: "Skipped: SECURITY_SWEEP",
          error: Prisma.JsonNull,
        },
        select: { id: true, runId: true },
      });
      jobId = job.id;

      await logAudit({
        userId,
        projectId,
        jobId,
        action: 'job.create',
        ip,
        metadata: { type: 'video-prompts', skipped: true, reason: 'SECURITY_SWEEP' },
      });

      return NextResponse.json(
        {
          jobId,
          runId: job.runId ?? effectiveRunId,
          started: false,
          skipped: true,
          reason: "SECURITY_SWEEP",
        },
        { status: 200 }
      );
    }

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.VIDEO_PROMPT_GENERATION,
        status: JobStatus.PENDING,
        idempotencyKey,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        payload: {
          storyboardId: storyboard.id,
          ...(storyboard.scriptId ? { scriptId: storyboard.scriptId } : {}),
          ...(resolvedProductId ? { productId: resolvedProductId } : {}),
          ...(requestedCharacterHandle ? { characterHandle: requestedCharacterHandle } : {}),
          idempotencyKey,
          ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        },
      },
      select: { id: true, runId: true },
    });
    jobId = job.id;
    reservation = null;

    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-prompts',
      },
    });

    return NextResponse.json(
      {
        jobId: job.id,
        runId: job.runId ?? effectiveRunId,
        storyboardId: storyboard.id,
        scriptId: storyboard.scriptId ?? null,
        productId: resolvedProductId,
        queued: true,
        reused: false,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error(err);
    if (reservation && !jobId) {
      await rollbackQuota(userId, reservation.periodKey, 'videoJobs', 1);
    }
    await logAudit({
      userId,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-prompts',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Video prompt generation failed' },
      { status: 500 },
    );
  }
}
