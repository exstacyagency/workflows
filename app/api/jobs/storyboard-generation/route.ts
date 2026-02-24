// app/api/jobs/storyboard-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { JobStatus, JobType, Prisma, ScriptStatus } from "@prisma/client";
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().optional(),
  productId: z.string().optional(),
  runId: z.string().optional(),
  characterId: z.string().optional(),
  storyboardMode: z.enum(["ai", "manual"]).optional(),
  manualPanels: z
    .array(
      z.object({
        beatLabel: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        vo: z.string().optional(),
        creatorAction: z.string().optional(),
        textOverlay: z.string().optional(),
        visualDescription: z.string().optional(),
        productPlacement: z.string().optional(),
      }),
    )
    .optional(),
  attemptKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const securitySweep = cfg.raw("SECURITY_SWEEP") === "1";
  let reservation: { periodKey: string; metric: string; amount: number } | null = null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body', details: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      projectId,
      scriptId: rawScriptId,
      productId: rawProductId,
      runId: rawRunId,
      characterId: rawCharacterId,
      storyboardMode: rawStoryboardMode,
      manualPanels: rawManualPanels,
      attemptKey: rawAttemptKey,
    } = parsed.data;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Plan gate AFTER ownership to avoid leaking project existence via 402.
    try {
      planId = await assertMinPlan(userId, 'GROWTH');
    } catch (err: any) {
      if (err instanceof UpgradeRequiredError) {
        return NextResponse.json(
          { error: 'Upgrade required', requiredPlan: err.requiredPlan },
          { status: 402 }
        );
      }
      console.error(err);
      return NextResponse.json({ error: 'Billing check failed' }, { status: 500 });
    }

    // Rate limit to prevent spam
    if (cfg.raw("NODE_ENV") === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const requestedRunId = String(rawRunId ?? "").trim();
    const requestedProductId = String(rawProductId ?? "").trim();
    const requestedCharacterId = String(rawCharacterId ?? "").trim();
    const storyboardMode = rawStoryboardMode === "manual" ? "manual" : "ai";
    const manualPanels = storyboardMode === "manual" && Array.isArray(rawManualPanels)
      ? rawManualPanels
      : undefined;
    const attemptKey = String(rawAttemptKey ?? "").trim() || `${Date.now()}`;
    let effectiveRunId: string | null = null;
    let effectiveProductId: string | null = null;
    let effectiveCharacterId: string | null = null;
    let effectiveCharacterHandle: string | null = null;
    if (requestedRunId) {
      const run = await prisma.researchRun.findUnique({
        where: { id: requestedRunId },
        select: { id: true, projectId: true },
      });
      if (!run || run.projectId !== projectId) {
        return NextResponse.json(
          { error: 'runId not found for this project' },
          { status: 400 }
        );
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
        return NextResponse.json(
          { error: "productId not found for this project" },
          { status: 400 }
        );
      }
      effectiveProductId = requestedProductId;
    }

    if (requestedCharacterId) {
      const character = await prisma.character.findFirst({
        where: {
          id: requestedCharacterId,
          projectId,
        },
        select: {
          id: true,
          runId: true,
          productId: true,
          characterUserName: true,
        },
      });
      if (!character) {
        return NextResponse.json(
          { error: "characterId not found for this project" },
          { status: 400 },
        );
      }
      if (effectiveRunId && character.runId !== effectiveRunId) {
        return NextResponse.json(
          { error: "characterId does not belong to selected run" },
          { status: 400 },
        );
      }
      if (effectiveProductId && character.productId !== effectiveProductId) {
        return NextResponse.json(
          { error: "characterId does not belong to selected product" },
          { status: 400 },
        );
      }
      const username = String(character.characterUserName ?? "").trim();
      if (!username) {
        return NextResponse.json(
          { error: "Selected character has no character handle" },
          { status: 400 },
        );
      }
      effectiveCharacterId = character.id;
      effectiveCharacterHandle = `@${username.replace(/^@+/, "")}`;
    }

    const requestedScriptId = String(rawScriptId ?? "").trim();
    const script = requestedScriptId
      ? await prisma.script.findFirst({
          where: {
            id: requestedScriptId,
            projectId,
          },
          select: { id: true },
        })
      : await prisma.script.findFirst({
          where: {
            projectId,
            status: ScriptStatus.READY,
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

    if (!script) {
      return NextResponse.json(
        {
          error: requestedScriptId
            ? 'scriptId is invalid for this project'
            : 'No ready script found. Generate script first.',
        },
        { status: 400 }
      );
    }

    // Idempotency: one storyboard generation job per (projectId, scriptIdUsed)
    const scriptIdUsed = script.id;
    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.STORYBOARD_GENERATION,
      scriptIdUsed,
      effectiveProductId ?? "no_product",
      effectiveRunId ?? "no_run",
      effectiveCharacterId ?? "no_character",
      storyboardMode,
      attemptKey,
    ]);

    const existing = await prisma.job.findFirst({
      where: {
        projectId,
        userId,
        type: JobType.STORYBOARD_GENERATION,
        idempotencyKey,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, runId: true },
    });

    if (existing) {
      // SECURITY_SWEEP expects deterministic "skipped" semantics even for reuse.
      if (securitySweep) {
        return NextResponse.json(
          {
            ok: true,
            jobId: existing.id,
            runId: existing.runId ?? effectiveRunId,
            scriptIdUsed,
            reused: true,
            started: false,
            skipped: true,
            reason: 'SECURITY_SWEEP',
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          ok: true,
          jobId: existing.id,
          runId: existing.runId ?? effectiveRunId,
          scriptIdUsed,
          reused: true,
          started: existing.status === JobStatus.PENDING || existing.status === JobStatus.RUNNING,
        },
        { status: 200 },
      );
    }

    // Quota: storyboard generation consumes researchQueries (same bucket as other research-y jobs).
    try {
      reservation = await reserveQuota(userId, planId, 'researchQueries', 1);
    } catch (err: any) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json(
          { error: 'Quota exceeded', metric: 'researchQueries', limit: err.limit, used: err.used },
          { status: 429 }
        );
      }
      throw err;
    }

    const payload = {
      projectId,
      scriptId: scriptIdUsed,
      ...(effectiveProductId ? { productId: effectiveProductId } : {}),
      ...(effectiveCharacterId ? { characterId: effectiveCharacterId } : {}),
      ...(effectiveCharacterHandle ? { characterHandle: effectiveCharacterHandle } : {}),
      storyboardMode,
      ...(manualPanels ? { manualPanels } : {}),
      idempotencyKey,
      ...(effectiveRunId ? { runId: effectiveRunId } : {}),
      ...(reservation ? { quotaReservation: reservation } : {}),
      ...(securitySweep ? { skipped: true, reason: 'SECURITY_SWEEP' } : {}),
    };

    const job = await prisma.job.create({
      data: {
        projectId,
        userId,
        type: JobType.STORYBOARD_GENERATION,
        status: securitySweep ? JobStatus.COMPLETED : JobStatus.PENDING,
        idempotencyKey,
        payload,
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
        ...(securitySweep
          ? {
              resultSummary: 'Skipped: SECURITY_SWEEP',
              error: Prisma.JsonNull,
            }
          : {}),
      },
      select: { id: true, runId: true },
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
        runId: job.runId ?? effectiveRunId,
        scriptIdUsed,
        storyboardMode,
        ...(effectiveCharacterId ? { characterId: effectiveCharacterId } : {}),
        ...(effectiveCharacterHandle ? { characterHandle: effectiveCharacterHandle } : {}),
        reused: false,
        started: !securitySweep,
        ...(securitySweep ? { skipped: true, reason: 'SECURITY_SWEEP' } : {}),
      },
      { status: securitySweep ? 200 : 202 },
    );
  } catch (err: any) {
    console.error(err);
    if (reservation) {
      try {
        await rollbackQuota(userId, reservation.periodKey, 'researchQueries', 1);
      } catch {}
    }
    return NextResponse.json(
      { error: err?.message ?? 'Storyboard generation failed' },
      { status: 500 }
    );
  }
}
