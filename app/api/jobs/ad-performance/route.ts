// app/api/jobs/ad-performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startAdRawCollectionJob } from '@/lib/adRawCollectionService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, industryCode } = body;

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
    if (!industryCode || typeof industryCode !== 'string') {
      return NextResponse.json(
        { error: 'industryCode is required' },
        { status: 400 },
      );
    }

    const result = await startAdRawCollectionJob({ projectId, industryCode });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Ad performance collection failed' },
      { status: 500 },
    );
  }
}
