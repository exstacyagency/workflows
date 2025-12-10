// app/api/jobs/video-reviewer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runVideoReviewer } from '@/lib/videoReviewerService';

export async function POST(_req: NextRequest) {
  try {
    const result = await runVideoReviewer();
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Video reviewer failed' },
      { status: 500 },
    );
  }
}
