
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
  const product = searchParams.get('product');
  const runId = searchParams.get('runId');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 100;
  const parsedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const where: any = { projectId };

  if (jobId) {
    where.jobId = jobId;
  } else if (product) {
    const productJobs = await prisma.job.findMany({
      where: {
        projectId,
        type: 'CUSTOMER_RESEARCH',
        payload: {
          path: ['productName'],
          equals: product,
        },
      },
      select: { id: true },
    });

    const jobIds = productJobs.map((j) => j.id);
    if (jobIds.length > 0) {
      where.jobId = { in: jobIds };
    } else {
      console.log('[research-api] no jobs for product', { projectId, product });
      return NextResponse.json({ rows: [], total: 0 });
    }
  }

  if (runId) {
    const runJobs = await prisma.job.findMany({
      where: {
        projectId,
        runId,
      },
      select: { id: true },
    });
    const runJobIds = runJobs.map((j) => j.id);
    if (runJobIds.length === 0) {
      console.log('[research-api] no jobs for runId', { projectId, runId });
      return NextResponse.json({ rows: [], total: 0 });
    }

    if (where.jobId) {
      if (typeof where.jobId === 'string') {
        if (!runJobIds.includes(where.jobId)) {
          console.log('[research-api] jobId not in runId set', { projectId, jobId: where.jobId, runId });
          return NextResponse.json({ rows: [], total: 0 });
        }
      } else if (where.jobId?.in) {
        const filtered = where.jobId.in.filter((id: string) => runJobIds.includes(id));
        if (filtered.length === 0) {
          console.log('[research-api] no matching jobs after runId filter', { projectId, runId });
          return NextResponse.json({ rows: [], total: 0 });
        }
        where.jobId = { in: filtered };
      }
    } else {
      where.jobId = { in: runJobIds };
    }
  }

  console.log('[research-api] fetch', { projectId, jobId, product, runId, limit, offset });

  const [rows, total] = await Promise.all([
    prisma.researchRow.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        jobId: true,
        type: true,
        source: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.researchRow.count({ where }),
  ]);

  console.log('[research-api] result', { projectId, jobId, total, rows: rows.length });

  return NextResponse.json({ rows, total });
}
