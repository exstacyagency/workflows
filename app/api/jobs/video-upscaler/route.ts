// app/api/jobs/video-upscaler/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runVideoUpscalerBatch } from '@/lib/videoUpscalerService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import prisma from '@/lib/prisma';
import { StoryboardJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAudit } from '@/lib/logger';
import { getSessionUser } from '@/lib/getSessionUser';

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  let projectId: string | null = null;
  let jobId: string | null = null;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const parsed = await parseJson(req, StoryboardJobSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { storyboardId } = parsed.data;

    const storyboard = await prisma.storyboard.findUnique({
      where: { id: storyboardId },
      include: {
        script: {
          include: { project: true },
        },
      },
    });

    if (!storyboard) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    projectId = storyboard.script?.project?.id ?? storyboard.projectId;
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const rateCheck = await checkRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded: ${rateCheck.reason}` },
        { status: 429 },
      );
    }

    const result = await runVideoUpscalerBatch();

    await logAudit({
      userId: user?.id ?? null,
      projectId,
      jobId,
      action: 'job.create',
      ip,
      metadata: {
        type: 'video-upscaler',
      },
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    await logAudit({
      userId: user?.id ?? null,
      projectId,
      jobId,
      action: 'job.error',
      ip,
      metadata: {
        type: 'video-upscaler',
        error: String(err?.message ?? err),
      },
    });
    return NextResponse.json(
      { error: err?.message ?? 'Video upscaler failed' },
      { status: 500 },
    );
  }
}
