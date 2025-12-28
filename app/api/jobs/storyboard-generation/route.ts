// app/api/jobs/storyboard-generation/route.ts
import { cfg } from "@/lib/config";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { assertMinPlan } from '../../../../lib/billing/requirePlan';
import { checkRateLimit } from '../../../../lib/rateLimiter';

const BodySchema = z.object({
  projectId: z.string().min(1),
  scriptId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Plan gate: ALL users are paid; require at least GROWTH
  await assertMinPlan(userId, 'GROWTH');

  const body = await req.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { projectId, scriptId } = parsed.data;

  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
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
    return NextResponse.json(
      { ok: true, storyboardId: existing.id, scriptIdUsed, reused: true },
      { status: 200 },
    );
  }

  const storyboard = await prisma.storyboard.create({
    data: {
      projectId,
      scriptId: scriptIdUsed,
    },
  });

  return NextResponse.json(
    { ok: true, storyboardId: storyboard.id, scriptIdUsed, reused: false },
    { status: 200 },
  );
}
