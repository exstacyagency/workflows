// app/api/jobs/ad-transcripts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startAdTranscriptJob } from '@/lib/adTranscriptCollectionService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId } = body;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 },
      );
    }
    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await startAdTranscriptJob(projectId);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Ad transcript job failed' },
      { status: 500 },
    );
  }
}
