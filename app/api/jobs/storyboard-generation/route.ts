// app/api/jobs/storyboard-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().optional(),
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

    const { projectId, scriptId } = parsed.data;

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

    // Idempotency: one storyboard per (projectId, scriptIdUsed)
    const scriptIdUsed = scriptId ?? null;
    const idempotencyKey = JSON.stringify([
      projectId,
      'STORYBOARD_GENERATION',
      scriptIdUsed,
    ]);

    const existing = await prisma.storyboard.findFirst({
      where: {
        projectId,
        scriptId: scriptIdUsed,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing?.id) {
      // SECURITY_SWEEP expects deterministic "skipped" semantics even for reuse.
      if (securitySweep) {
        return NextResponse.json(
          { ok: true, storyboardId: existing.id, scriptIdUsed, reused: true, skipped: true, reason: 'SECURITY_SWEEP' },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { ok: true, storyboardId: existing.id, scriptIdUsed, reused: true },
        { status: 200 },
      );
    }

    // SECURITY_SWEEP: after plan+quota, do deterministic creation without downstream model calls.
    // This route already only creates a DB record, so we can still create it and mark skipped.
    const storyboard = await prisma.storyboard.create({
      data: { projectId, scriptId: scriptIdUsed },
      select: { id: true },
    });

    return NextResponse.json(
      {
        ok: true,
        storyboardId: storyboard.id,
        scriptIdUsed,
        reused: false,
        ...(securitySweep ? { skipped: true, reason: 'SECURITY_SWEEP' } : {}),
      },
      { status: 200 },
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
