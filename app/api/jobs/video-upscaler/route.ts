// app/api/jobs/video-upscaler/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runVideoUpscalerBatch } from '@/lib/videoUpscalerService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const projectId = body?.projectId;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await runVideoUpscalerBatch();
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Video upscaler failed' },
      { status: 500 },
    );
  }
}
