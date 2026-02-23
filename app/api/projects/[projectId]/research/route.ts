
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth/requireSession';
import { requireProjectOwner404 } from '@/lib/auth/requireProjectOwner404';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function buildResearchWhere(args: {
  projectId: string;
  jobId?: string | null;
  jobType?: string | null;
  runId?: string | null;
  productId?: string | null;
  product?: string | null;
  subreddit?: string | null;
  solutionKeyword?: string | null;
  minScoreParam?: string | null;
}) {
  const { projectId, jobId, jobType, runId, productId, product, subreddit, solutionKeyword, minScoreParam } = args;
  const parsedMinScore = minScoreParam ? Number.parseInt(minScoreParam, 10) : 0;
  const hasMinScore = Number.isFinite(parsedMinScore) && parsedMinScore > 0;
  const where: any = { projectId };

  if (jobId) {
    where.jobId = jobId;
    if (runId || jobType) {
      where.job = {
        ...(where.job ?? {}),
        ...(runId ? { runId } : {}),
        ...(jobType ? { type: jobType as any } : {}),
      };
    }
  } else if (runId || jobType) {
    where.job = {
      ...(where.job ?? {}),
      ...(runId ? { runId } : {}),
      ...(jobType ? { type: jobType as any } : {}),
    };
  }
  if (!jobId && (productId || product)) {
    const productJobs = await prisma.job.findMany({
      where: {
        projectId,
        ...(jobType ? { type: jobType as any } : {}),
        ...(productId
          ? {
              payload: {
                path: ['productId'],
                equals: productId,
              },
            }
          : {}),
        ...(!productId && product
          ? {
              payload: {
                path: ['productName'],
                equals: product,
              },
            }
          : {}),
      },
      select: { id: true },
    });

    const jobIds = productJobs.map((job) => job.id);
    if (jobIds.length > 0) {
      where.jobId = { in: jobIds };
    } else {
      where.jobId = { in: [] as string[] };
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

  return where;
}

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
  const jobType = searchParams.get('jobType');
  const runId = searchParams.get('runId');
  const productId = searchParams.get('productId');
  const product = searchParams.get('product');
  const subreddit = searchParams.get('subreddit');
  const solutionKeyword = searchParams.get('solutionKeyword');
  const minScoreParam = searchParams.get('minScore');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 100;
  const parsedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  const where = await buildResearchWhere({
    projectId,
    jobId,
    jobType,
    runId,
    productId,
    product,
    subreddit,
    solutionKeyword,
    minScoreParam,
  });

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

export async function DELETE(req: NextRequest, { params }: { params: { projectId: string } }) {
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rowId = String(body?.rowId || '').trim();
  const rowIds = Array.isArray(body?.rowIds)
    ? body.rowIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const deleteAll = body?.deleteAll === true;
  const jobType = String(body?.jobType || '').trim();
  const runId = String(body?.runId || '').trim();
  const productId = String(body?.productId || '').trim();
  const jobId = String(body?.jobId || '').trim();
  const product = String(body?.product || '').trim();
  const subreddit = String(body?.subreddit || '').trim();
  const solutionKeyword = String(body?.solutionKeyword || '').trim();
  const minScoreParam = body?.minScore !== undefined && body?.minScore !== null ? String(body.minScore) : null;

  if (!deleteAll && !rowId && rowIds.length === 0) {
    return NextResponse.json(
      { error: 'rowId, rowIds, or deleteAll is required' },
      { status: 400 },
    );
  }

  if (deleteAll) {
    const where = await buildResearchWhere({
      projectId,
      jobId: jobId || null,
      jobType: jobType || null,
      runId: runId || null,
      productId: productId || null,
      product: product || null,
      subreddit: subreddit || null,
      solutionKeyword: solutionKeyword || null,
      minScoreParam,
    });
    const result = await prisma.researchRow.deleteMany({ where });
    return NextResponse.json({ success: true, deletedCount: result.count });
  }

  if (rowIds.length > 0) {
    const result = await prisma.researchRow.deleteMany({
      where: {
        projectId,
        id: { in: rowIds },
        ...(runId || jobType
          ? {
              job: {
                ...(runId ? { runId } : {}),
                ...(jobType ? { type: jobType as any } : {}),
              },
            }
          : {}),
      },
    });
    return NextResponse.json({ success: true, deletedCount: result.count });
  }

  const row = await prisma.researchRow.findFirst({
    where: {
      id: rowId,
      projectId,
      ...(runId || jobType
        ? {
            job: {
              ...(runId ? { runId } : {}),
              ...(jobType ? { type: jobType as any } : {}),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: 'Data point not found for this project/run' }, { status: 404 });
  }
  await prisma.researchRow.delete({ where: { id: row.id } });
  return NextResponse.json({ success: true, deletedRowId: row.id, deletedCount: 1 });
}
