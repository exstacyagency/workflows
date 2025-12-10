// app/api/jobs/video-images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startVideoImageGenerationJob } from '@/lib/videoImageGenerationService';

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

    const result = await startVideoImageGenerationJob(storyboardId);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Video image generation failed' },
      { status: 500 },
    );
  }
}
