// app/api/jobs/video-upscaler/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runVideoUpscalerBatch } from '@/lib/videoUpscalerService';

export async function POST(_req: NextRequest) {
  try {
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
