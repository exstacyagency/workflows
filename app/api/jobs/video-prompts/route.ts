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
      select: { projectId: true },
    });
    if (!storyboard) {
      return NextResponse.json({ error: 'Storyboard not found' }, { status: 404 });
    }

    const auth = await requireProjectOwner(storyboard.projectId);
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
