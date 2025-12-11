// app/api/jobs/ad-performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { startAdRawCollectionJob } from '@/lib/adRawCollectionService';
import { requireProjectOwner } from '@/lib/requireProjectOwner';
import { ProjectJobSchema, parseJson } from '@/lib/validation/jobs';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rateLimiter';

const AdPerformanceSchema = ProjectJobSchema.extend({
  industryCode: z.string().min(1, 'industryCode is required'),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJson(req, AdPerformanceSchema);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error, details: parsed.details },
        { status: 400 },
      );
    }
    const { projectId, industryCode } = parsed.data;

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
