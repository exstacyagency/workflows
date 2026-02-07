import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeReviewText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
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

  const where: { projectId: string; jobId?: string } = { projectId };
  if (jobId) {
    where.jobId = jobId;
  }

  const [rows, amazonReviews] = await Promise.all([
    prisma.researchRow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        jobId: true,
        type: true,
        source: true,
        content: true,
        metadata: true,
        createdAt: true
      }
    }),
    prisma.amazonReview.findMany({
      where,
      select: {
        jobId: true,
        reviewText: true,
        productType: true,
        productAsin: true,
        rating: true,
        productName: true
      }
    })
  ]);

  const amazonByKey = new Map<
    string,
    { productType: string; productAsin: string; rating: number | null; productName: string | null }
  >();

  for (const review of amazonReviews) {
    const key = `${review.jobId ?? ''}::${normalizeReviewText(review.reviewText)}`;
    if (!amazonByKey.has(key)) {
      amazonByKey.set(key, {
        productType: review.productType,
        productAsin: review.productAsin,
        rating: review.rating ?? null,
        productName: review.productName ?? null
      });
    }
  }

  const headers = [
    'Type',
    'Source',
    'Content',
    'Score',
    'productType',
    'productAsin',
    'rating',
    'productName',
    'Created At'
  ];
  const csvRows = rows.map((row) => {
    const metadata = (row.metadata as any) ?? {};
    const amazonMatch = amazonByKey.get(`${row.jobId ?? ''}::${normalizeReviewText(row.content)}`);
    const isAmazonSource = String(row.source).startsWith('AMAZON');

    const productType =
      metadata.productType ??
      metadata.product_type ??
      (isAmazonSource ? amazonMatch?.productType ?? '' : '');
    const productAsin =
      metadata.productAsin ??
      metadata.asin ??
      (isAmazonSource ? amazonMatch?.productAsin ?? '' : '');
    const rating =
      metadata.rating ??
      (isAmazonSource ? amazonMatch?.rating ?? '' : '');
    const productName =
      metadata.productName ??
      metadata.product_name ??
      (isAmazonSource ? amazonMatch?.productName ?? '' : '');

    return [
      row.type ?? '',
      row.source,
      csvEscape(row.content || ''),
      metadata.score ?? 0,
      productType,
      productAsin,
      rating ?? '',
      csvEscape(productName),
      row.createdAt.toISOString()
    ];
  });

  const csv = [headers.join(','), ...csvRows.map((row) => row.join(','))].join('\n');
  const filename = jobId ? `research-${jobId}.csv` : 'research-all.csv';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
