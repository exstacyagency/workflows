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
  const runId = searchParams.get('runId');
  const subreddit = searchParams.get('subreddit');
  const solutionKeyword = searchParams.get('solutionKeyword');
  const minScoreParam = searchParams.get('minScore');
  const parsedMinScore = minScoreParam ? Number.parseInt(minScoreParam, 10) : 0;
  const hasMinScore = Number.isFinite(parsedMinScore) && parsedMinScore > 0;

  const where: any = { projectId };
  if (jobId) {
    where.jobId = jobId;
  }
  if (runId) {
    where.job = { ...(where.job ?? {}), runId };
  }
  if (subreddit) {
    where.subreddit = subreddit;
  }
  if (solutionKeyword) {
    where.solutionKeyword = solutionKeyword;
  }
  if (hasMinScore) {
    where.metadata = {
      path: ['score'],
      gte: parsedMinScore,
    } as any;
  }

  const [rows, amazonReviews] = await Promise.all([
    prisma.researchRow.findMany({
      where,
      orderBy: [{ redditCreatedUtc: 'desc' }, { createdAt: 'desc' }],
      select: {
        jobId: true,
        type: true,
        source: true,
        subreddit: true,
        redditId: true,
        redditCreatedUtc: true,
        searchQueryUsed: true,
        solutionKeyword: true,
        problemKeyword: true,
        productType: true,
        productAsin: true,
        rating: true,
        productName: true,
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
    'Subreddit',
    'Solution Keyword',
    'Problem Keyword',
    'Content',
    'Score',
    'productType',
    'productAsin',
    'rating',
    'productName',
    'Reddit ID',
    'Posted Date',
    'Search Query Used',
    'Created At'
  ];
  const csvRows = rows.map((row) => {
    const metadata = (row.metadata as any) ?? {};
    const amazonMatch = amazonByKey.get(`${row.jobId ?? ''}::${normalizeReviewText(row.content)}`);
    const isAmazonSource = String(row.source).startsWith('AMAZON');

    const productType =
      row.productType ??
      metadata.productType ??
      metadata.product_type ??
      (isAmazonSource ? amazonMatch?.productType ?? '' : '');
    const productAsin =
      row.productAsin ??
      metadata.productAsin ??
      metadata.asin ??
      (isAmazonSource ? amazonMatch?.productAsin ?? '' : '');
    const rating =
      row.rating ??
      metadata.rating ??
      (isAmazonSource ? amazonMatch?.rating ?? '' : '');
    const productName =
      row.productName ??
      metadata.productName ??
      metadata.product_name ??
      (isAmazonSource ? amazonMatch?.productName ?? '' : '');
    const postedDate =
      typeof row.redditCreatedUtc === 'bigint'
        ? new Date(Number(row.redditCreatedUtc) * 1000).toISOString()
        : '';
    const subredditValue = row.subreddit ?? metadata.subreddit ?? '';
    const solutionKeywordValue = row.solutionKeyword ?? metadata.solution_keyword ?? '';
    const problemKeywordValue =
      row.problemKeyword ?? metadata.problem_keyword ?? metadata.search_problem ?? '';
    const searchQueryUsedValue = row.searchQueryUsed ?? metadata.query_used ?? '';

    return [
      row.type ?? '',
      row.source,
      subredditValue,
      solutionKeywordValue,
      problemKeywordValue,
      csvEscape(row.content || ''),
      metadata.score ?? 0,
      productType,
      productAsin,
      rating ?? '',
      csvEscape(productName),
      row.redditId ?? '',
      postedDate,
      csvEscape(searchQueryUsedValue),
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
