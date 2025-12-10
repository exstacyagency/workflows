// app/api/jobs/character-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startCharacterGenerationJob } from '@/lib/characterGenerationService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, productName } = body;

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 },
      );
    }
    if (!productName || typeof productName !== 'string') {
      return NextResponse.json(
        { error: 'productName is required' },
        { status: 400 },
      );
    }

    const result = await startCharacterGenerationJob({ projectId, productName });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? 'Character generation failed' },
      { status: 500 },
    );
  }
}
