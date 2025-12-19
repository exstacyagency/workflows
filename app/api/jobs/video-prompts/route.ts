// app/api/jobs/video-prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startVideoPromptGenerationJob } from '../../../../lib/videoPromptGenerationService';
import { prisma } from '../../../../lib/prisma';
import { requireProjectOwner } from '../../../../lib/requireProjectOwner';
import { checkRateLimit } from '../../../../lib/rateLimiter';
import { logAudit } from '../../../../lib/logger';
import { getSessionUserId } from '../../../../lib/getSessionUserId';
import { enforceUserConcurrency, findIdempotentJob } from '../../../../lib/jobGuards';
import { JobStatus, JobType } from '@prisma/client';
import { assertMinPlan, UpgradeRequiredError } from '../../../../lib/billing/requirePlan';
import { reserveQuota, rollbackQuota, QuotaExceededError } from '../../../../lib/billing/usage';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let projectId: string | null = null;
  let jobId: string | null = null;
  let reservation: { periodKey: string; metric: string; amount: number } | null =
    null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  let planId: 'FREE' | 'GROWTH' | 'SCALE' = 'FREE';

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

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body', details: 'Invalid JSON body' }, { status: 400 });
    }

    const BodySchema = z
      .object({
        storyboardId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        scriptId: z.string().min(1).optional(),
      })
      .superRefine((data, ctx) => {
        const hasStoryboard = !!data.storyboardId;
        const hasProjectScript = !!data.projectId && !!data.scriptId;
        const hasPartialProjectScript =
          (!!data.projectId && !data.scriptId) || (!data.projectId && !!data.scriptId);

        if (hasStoryboard && (data.projectId || data.scriptId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide either storyboardId or projectId+scriptId',
          });
        } else if (hasPartialProjectScript) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide both projectId and scriptId',
          });
        } else if (!hasStoryboard && !hasProjectScript) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide storyboardId or projectId+scriptId',
          });
        }
      });

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    let storyboardId = parsed.data.storyboardId ?? null;
    const bodyProjectId = parsed.data.projectId ?? null;
    const scriptId = parsed.data.scriptId ?? null;

    if (storyboardId) {
      const storyboard = await prisma.storyboard.findUnique({
        where: { id: storyboardId },
        select: { id: true, projectId: true },
      });
      if (!storyboard) {
        return NextResponse.json(
          { error: 'Storyboard or project not found' },
          { status: 404 },
        );
      }
      projectId = storyboard.projectId;
    } else if (bodyProjectId && scriptId) {
      const script = await prisma.script.findUnique({
        where: { id: scriptId },
        select: { id: true, projectId: true },
      });
      if (!script || script.projectId !== bodyProjectId) {
        return NextResponse.json(
          { error: 'Script or project not found' },
          { status: 404 },
        );
      }

      projectId = bodyProjectId;

      const auth = await requireProjectOwner(projectId);
      if (auth.error) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }

      let storyboard = await prisma.storyboard.findFirst({
        where: { scriptId, projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (!storyboard) {
        storyboard = await prisma.storyboard.create({
          data: { projectId, scriptId },
          select: { id: true },
        });
      }

      storyboardId = storyboard.id;

      const existingScene = await prisma.storyboardScene.findFirst({
        where: { storyboardId },
        select: { id: true },
      });
      if (!existingScene) {
        await prisma.storyboardScene.create({
          data: {
            storyboardId,
            sceneNumber: 1,
            durationSec: 8,
            aspectRatio: '9:16',
            status: 'pending',
            sceneFull: '',
            rawJson: {},
          },
        });
      }
    }

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'Invalid request body', details: 'Provide storyboardId or projectId+scriptId' },
        { status: 400 },
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 },
      );
    }

    if (parsed.data.storyboardId) {
      const auth = await requireProjectOwner(projectId);
      if (auth.error) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }
    }

    const concurrency = await enforceUserConcurrency(userId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.reason },
        { status: 429 },
      );
    }

    if (process.env.NODE_ENV === 'production') {
      const rateCheck = await checkRateLimit(projectId);
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: `Rate limit exceeded: ${rateCheck.reason}` },
          { status: 429 },
        );
      }
    }

    const idempotencyKey = JSON.stringify([
      projectId,
      JobType.VIDEO_PROMPT_GENERATION,
      storyboardId,
    ]);
    const existing = await findIdempotentJob({
      projectId,
      type: JobType.VIDEO_PROMPT_GENERATION,
      idempotencyKey,
    });
    if (existing) {
      return NextResponse.json({ jobId: existing.id, reused: true }, { status: 200 });
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

    const job = await prisma.job.create({
      data: {
        projectId,
        type: JobType.VIDEO_PROMPT_GENERATION,
        status: JobStatus.PENDING,
        payload: { storyboardId, idempotencyKey },
      },
    });
    jobId = job.id;

    const result = await startVideoPromptGenerationJob({
      storyboardId,
      jobId: job.id,
    });

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

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    if (reservation) {
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
