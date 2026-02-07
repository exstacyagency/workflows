
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    const jobIds = productJobs.map((job) => job.id);
    if (jobIds.length > 0) {
      where.jobId = { in: jobIds };
    } else {
      return NextResponse.json({ rows: [], total: 0 });
    }
  }

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
        createdAt: true
      }
    }),
    prisma.researchRow.count({ where })
  ]);

  const normalizedRows = rows.map((row) => {
    const metadata = (row.metadata as any) ?? {};
    return {
      ...row,
      productType: metadata.productType ?? metadata.product_type ?? null,
      productAsin: metadata.productAsin ?? metadata.asin ?? null,
      rating: metadata.rating ?? null,
      productName: metadata.productName ?? metadata.product_name ?? null,
    };
  });

  return NextResponse.json(
    { rows: normalizedRows, total },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
