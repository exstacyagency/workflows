// app/api/jobs/video-prompts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startVideoPromptGenerationJob } from '@/lib/videoPromptGenerationService';

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
