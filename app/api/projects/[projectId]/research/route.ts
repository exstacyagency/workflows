
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
  const runId = searchParams.get('runId');
  const product = searchParams.get('product');
  const subreddit = searchParams.get('subreddit');
  const solutionKeyword = searchParams.get('solutionKeyword');
  const minScoreParam = searchParams.get('minScore');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 100;
  const parsedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
  const parsedMinScore = minScoreParam ? Number.parseInt(minScoreParam, 10) : 0;
  const hasMinScore = Number.isFinite(parsedMinScore) && parsedMinScore > 0;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const where: any = { projectId };
  if (jobId) {
    where.jobId = jobId;
  }
  if (runId) {
    where.job = { ...(where.job ?? {}), runId };
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
      return NextResponse.json({
        rows: [],
        total: 0,
        stats: {
          totalRows: 0,
          uniqueSubreddits: 0,
          avgScore: 0,
          topKeyword: 'N/A',
          topKeywordCount: 0,
        },
        keywordStats: [],
      });
    }
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

  const [rows, total] = await Promise.all([
    prisma.researchRow.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ redditCreatedUtc: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        jobId: true,
        type: true,
        source: true,
        content: true,
        subreddit: true,
        redditId: true,
        redditParentId: true,
        redditCreatedUtc: true,
        searchQueryUsed: true,
        solutionKeyword: true,
        problemKeyword: true,
        productType: true,
        productAsin: true,
        rating: true,
        productName: true,
        metadata: true,
        createdAt: true
      }
    }),
    prisma.researchRow.count({ where })
  ]);

  const normalizedRows = rows.map((row) => {
    const metadata = (row.metadata as any) ?? {};
    const score = Number(metadata?.score ?? 0) || 0;
    return {
      ...row,
      subreddit: row.subreddit ?? metadata.subreddit ?? null,
      redditCreatedUtc:
        typeof row.redditCreatedUtc === 'bigint'
          ? row.redditCreatedUtc.toString()
          : row.redditCreatedUtc ?? null,
      searchQueryUsed: row.searchQueryUsed ?? metadata.query_used ?? null,
      solutionKeyword: row.solutionKeyword ?? metadata.solution_keyword ?? null,
      problemKeyword:
        row.problemKeyword ?? metadata.problem_keyword ?? metadata.search_problem ?? null,
      productType: row.productType ?? metadata.productType ?? metadata.product_type ?? null,
      productAsin: row.productAsin ?? metadata.productAsin ?? metadata.asin ?? null,
      rating: row.rating ?? metadata.rating ?? null,
      productName: row.productName ?? metadata.productName ?? metadata.product_name ?? null,
      _score: score,
    };
  });

  const safeRows = normalizedRows.map(({ _score, ...row }) => row);

  const uniqueSubreddits = new Set(
    normalizedRows.map((row: any) => row.subreddit).filter(Boolean)
  ).size;
  const totalScore = normalizedRows.reduce((sum: number, row: any) => sum + (row._score || 0), 0);
  const avgScore = normalizedRows.length > 0 ? totalScore / normalizedRows.length : 0;

  const keywordAccumulator = normalizedRows.reduce(
    (acc: Record<string, { count: number; totalScore: number }>, row: any) => {
      const keyword = row.solutionKeyword;
      if (!keyword) return acc;
      if (!acc[keyword]) acc[keyword] = { count: 0, totalScore: 0 };
      acc[keyword].count += 1;
      acc[keyword].totalScore += row._score || 0;
      return acc;
    },
    {}
  );

  const keywordStats = Object.entries(keywordAccumulator)
    .map(([keyword, data]) => ({
      keyword,
      count: data.count,
      avgScore: data.count > 0 ? data.totalScore / data.count : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topKeyword = keywordStats[0]?.keyword ?? 'N/A';
  const topKeywordCount = keywordStats[0]?.count ?? 0;

  return NextResponse.json(
    {
      rows: safeRows,
      total,
      stats: {
        totalRows: total,
        uniqueSubreddits,
        avgScore,
        topKeyword,
        topKeywordCount,
      },
      keywordStats,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
