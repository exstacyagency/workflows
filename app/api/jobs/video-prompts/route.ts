// app/api/jobs/video-prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startVideoPromptGenerationJob } from '@/lib/videoPromptGenerationService';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { StoryboardJobSchema, parseJson } from '@/lib/validation/jobs';
import { checkRateLimit } from '@/lib/rateLimiter';

export async function POST(req: NextRequest) {
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

    const projectId = storyboard.script?.project?.id ?? storyboard.projectId;
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

    const result = await startVideoPromptGenerationJob(storyboardId);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Video prompt generation failed' },
      { status: 500 },
    );
  }
}
