// app/api/jobs/character-generation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startCharacterGenerationJob } from '@/lib/characterGenerationService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';

const CharacterGenerationSchema = ProjectJobSchema.extend({
  productName: z.string().min(1, 'productName is required'),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJson(req, CharacterGenerationSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId, productName } = parsed.data;

    const auth = await requireProjectOwner(projectId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const rateCheck = await checkRateLimit(projectId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded: ${rateCheck.reason}` },
        { status: 429 },
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
