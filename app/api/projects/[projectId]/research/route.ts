
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { projectId } = params;
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  const deny = await requireProjectOwner404(projectId);
  if (deny) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 100;
  const parsedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const where: { projectId: string; jobId?: string } = { projectId };
  if (jobId) {
    where.jobId = jobId;
  }

  const [rows, total] = await Promise.all([
    prisma.researchRow.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        source: true,
        content: true,
        metadata: true,
        createdAt: true
      }
    }),
    prisma.researchRow.count({ where })
  ]);

  return NextResponse.json({ rows, total });
}
