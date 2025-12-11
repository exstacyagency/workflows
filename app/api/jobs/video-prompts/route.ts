// app/api/jobs/video-prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startVideoPromptGenerationJob } from '@/lib/videoPromptGenerationService';
import prisma from '@/lib/prisma';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { storyboardId } = body;

    if (!storyboardId || typeof storyboardId !== 'string') {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 },
      );
    }

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
