'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface ResearchRow {
  id: string;
  type: string | null;
  source: string;
  content: string;
  subreddit?: string | null;
  redditId?: string | null;
  redditParentId?: string | null;
  redditCreatedUtc?: string | null;
  searchQueryUsed?: string | null;
  solutionKeyword?: string | null;
  problemKeyword?: string | null;
  productType?: string | null;
  productAsin?: string | null;
  rating?: number | null;
  productName?: string | null;
  metadata: any;
  createdAt: string;
}

interface ResearchStats {
  totalRows: number;
  uniqueSubreddits: number;
  avgScore: number;
  topKeyword: string;
  topKeywordCount: number;
}

interface KeywordStat {
  keyword: string;
  count: number;
  avgScore: number;
}

export default function ResearchDataPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;
  const runId = searchParams.get('runId');

  const [rows, setRows] = useState<ResearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<ResearchStats>({
    totalRows: 0,
    uniqueSubreddits: 0,
    avgScore: 0,
    topKeyword: 'N/A',
    topKeywordCount: 0,
  });
  const [keywordStats, setKeywordStats] = useState<KeywordStat[]>([]);
  const [page, setPage] = useState(1);
  const rowsPerPage = 100;
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [subredditFilter, setSubredditFilter] = useState('');
  const [solutionKeywordFilter, setSolutionKeywordFilter] = useState('');
  const [minScoreFilter, setMinScoreFilter] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * rowsPerPage;
      const params = new URLSearchParams({
        jobId,
        limit: String(rowsPerPage),
        offset: String(offset),
      });
      if (runId) params.set('runId', runId);
      if (subredditFilter) params.set('subreddit', subredditFilter);
      if (solutionKeywordFilter) params.set('solutionKeyword', solutionKeywordFilter);
      if (minScoreFilter > 0) params.set('minScore', String(minScoreFilter));

      const response = await fetch(`/api/projects/${projectId}/research?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      setRows(data.rows || []);
      setTotalCount(data.total || 0);
      setStats(
        data.stats || {
          totalRows: data.total || 0,
          uniqueSubreddits: 0,
          avgScore: 0,
          topKeyword: 'N/A',
          topKeywordCount: 0,
        }
      );
      setKeywordStats(Array.isArray(data.keywordStats) ? data.keywordStats : []);
    } catch (error) {
      console.error('Failed to load research data:', error);
    } finally {
      setLoading(false);
    }
  }, [
    jobId,
    minScoreFilter,
    page,
    projectId,
    rowsPerPage,
    runId,
    solutionKeywordFilter,
    subredditFilter,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const uniqueSubreddits = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.subreddit).filter((value): value is string => Boolean(value)))).sort(),
    [rows]
  );

  const uniqueKeywords = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => row.solutionKeyword).filter((value): value is string => Boolean(value)))
      ).sort(),
    [rows]
  );

  const filteredRows = rows.filter((row) => {
    if (sourceFilter !== 'all') {
      if (sourceFilter === 'reddit' && !row.source.startsWith('REDDIT_')) return false;
      if (sourceFilter === 'amazon' && !row.source.startsWith('AMAZON')) return false;
      if (sourceFilter === 'uploaded' && row.source !== 'UPLOADED' && row.type !== 'UPLOADED') return false;
      if (!['reddit', 'amazon', 'uploaded'].includes(sourceFilter) && row.source !== sourceFilter) return false;
    }
    if (typeFilter !== 'all' && row.type !== typeFilter) return false;
    if (searchQuery && !row.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const filtersActive =
    sourceFilter !== 'all' ||
    typeFilter !== 'all' ||
    searchQuery ||
    subredditFilter ||
    solutionKeywordFilter ||
    minScoreFilter > 0;

  const formatDateTime = (date: string) =>
    new Date(date).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const getPostedTime = (row: ResearchRow) => {
    if (row.redditCreatedUtc) {
      const unix = Number(row.redditCreatedUtc);
      if (Number.isFinite(unix) && unix > 0) {
        return formatDistanceToNow(new Date(unix * 1000), { addSuffix: true });
      }
    }
    return '—';
  };

  const getDisplayType = (row: ResearchRow) => {
    if (row.source === 'UPLOADED' || row.type === 'UPLOADED' || row.type === 'document') return 'uploaded';
    if (row.source.startsWith('AMAZON') || row.type === 'review') return 'review';
    return row.type || 'unknown';
  };

  const getDisplaySource = (row: ResearchRow) => {
    if (row.source === 'UPLOADED') return row.metadata?.source || 'UPLOADED';
    return row.source;
  };

  const getDisplayScore = (row: ResearchRow) => {
    if (row.source.startsWith('AMAZON')) {
      return row.rating ?? row.metadata?.rating ?? '—';
    }
    return Number(row.metadata?.score ?? 0) || 0;
  };

  async function handleExport() {
    const params = new URLSearchParams({ jobId });
    if (runId) params.set('runId', runId);
    if (subredditFilter) params.set('subreddit', subredditFilter);
    if (solutionKeywordFilter) params.set('solutionKeyword', solutionKeywordFilter);
    if (minScoreFilter > 0) params.set('minScore', String(minScoreFilter));
    const response = await fetch(`/api/projects/${projectId}/research/export?${params.toString()}`, {
      cache: 'no-store',
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${jobId}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/projects/${projectId}/research-hub`} className="text-sm text-sky-400 hover:text-sky-300 mb-2 inline-block">
              ← Back to Research Hub
            </Link>
            <h1 className="text-2xl font-bold">Raw Research Data</h1>
            <p className="text-sm text-slate-400 mt-1">
              Job: {jobId.substring(0, 8)}
              {runId ? ` | Run: ${runId.substring(0, 8)}` : ''}
              {` | ${totalCount} total rows`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}/research/data/${jobId}/inputs${runId ? `?runId=${runId}` : ''}`}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium"
            >
              View Input Parameters
            </Link>
            <button onClick={handleExport} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium">
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-900/30 px-6 py-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-2xl font-semibold">{stats.totalRows}</div>
            <p className="mt-1 text-sm text-slate-400">Total data points</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-2xl font-semibold">{stats.uniqueSubreddits}</div>
            <p className="mt-1 text-sm text-slate-400">Subreddits</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-2xl font-semibold">{stats.avgScore.toFixed(1)}</div>
            <p className="mt-1 text-sm text-slate-400">Avg upvotes</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-2xl font-semibold">{stats.topKeyword}</div>
            <p className="mt-1 text-sm text-slate-400">Top keyword</p>
            <p className="text-xs text-slate-500">{stats.topKeywordCount} rows</p>
          </div>
        </div>

        {keywordStats.length > 0 && (
          <div className="mt-4 rounded border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Keyword Performance</h2>
            <div className="mt-3 space-y-2">
              {keywordStats.map((stat) => (
                <div key={stat.keyword} className="flex items-center justify-between rounded border border-slate-800 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-700 px-2 py-1 text-xs">{stat.keyword}</span>
                    <span className="text-sm text-slate-400">{stat.count} rows</span>
                  </div>
                  <div className="font-mono text-sm text-slate-300">{stat.avgScore.toFixed(1)} avg</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-6">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="all">All Sources</option>
            <option value="reddit">Reddit</option>
            <option value="amazon">Amazon</option>
            <option value="uploaded">Uploaded</option>
            <option value="REDDIT_PRODUCT">Reddit Product</option>
            <option value="REDDIT_PROBLEM">Reddit Problem</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="all">All Types</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
            <option value="review">Reviews</option>
            <option value="UPLOADED">Uploaded</option>
          </select>

          <select
            value={subredditFilter}
            onChange={(e) => {
              setSubredditFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">All subreddits</option>
            {uniqueSubreddits.map((subreddit) => (
              <option key={subreddit} value={subreddit}>
                {subreddit}
              </option>
            ))}
          </select>

          <select
            value={solutionKeywordFilter}
            onChange={(e) => {
              setSolutionKeywordFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">All solution keywords</option>
            {uniqueKeywords.map((keyword) => (
              <option key={keyword} value={keyword}>
                {keyword}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            value={minScoreFilter}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              setMinScoreFilter(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
            placeholder="Min score"
          />

          <input
            type="text"
            placeholder="Search content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          />
        </div>

        <div className="mt-3 text-sm text-slate-400">
          Showing {filteredRows.length} of {rows.length} loaded
          {filtersActive && ` (${totalCount} total in database)`}
        </div>
      </div>

      <div className="px-6 py-4">
        {filtersActive && (
          <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 mb-4">
            <p className="text-sm text-amber-300">
              Filters apply to server query (subreddit/keyword/min score) and client view (source/type/search) for this page.
            </p>
          </div>
        )}
        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-800">
                <thead className="bg-slate-900 border-b border-slate-700">
                  <tr>
                    <th className="text-left p-3 font-medium w-24">Type</th>
                    <th className="text-left p-3 font-medium w-44">Source</th>
                    <th className="text-left p-3 font-medium w-40">Subreddit</th>
                    <th className="text-left p-3 font-medium w-32">Solution</th>
                    <th className="text-left p-3 font-medium w-40">Problem</th>
                    <th className="text-left p-3 font-medium w-40">Query</th>
                    <th className="text-left p-3 font-medium">Content</th>
                    <th className="text-left p-3 font-medium w-20">Score</th>
                    <th className="text-left p-3 font-medium w-32">Reddit ID</th>
                    <th className="text-left p-3 font-medium w-32">Parent ID</th>
                    <th className="text-left p-3 font-medium w-32">Posted</th>
                    <th className="text-left p-3 font-medium w-40">Scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-900/50">
                      <td className="p-3">
                        <span className="px-2 py-1 bg-slate-700 rounded text-xs">{getDisplayType(row)}</span>
                      </td>
                      <td className="p-3 text-slate-400 text-xs">{getDisplaySource(row)}</td>
                      <td className="p-3 text-slate-400 text-xs">{row.subreddit || '-'}</td>
                      <td className="p-3 text-slate-300 text-xs">{row.solutionKeyword || '-'}</td>
                      <td className="p-3 text-slate-300 text-xs">{row.problemKeyword || '-'}</td>
                      <td className="p-3 text-slate-300 text-xs font-mono">{row.searchQueryUsed || '-'}</td>
                      <td className="p-3">
                        {row.content.substring(0, 220)}
                        {row.content.length > 220 && '...'}
                      </td>
                      <td className="p-3 text-slate-400">{getDisplayScore(row)}</td>
                      <td className="p-3 text-slate-300 text-xs font-mono">{row.redditId || '-'}</td>
                      <td className="p-3 text-slate-300 text-xs font-mono">{row.redditParentId || '-'}</td>
                      <td className="p-3 text-slate-400 text-xs">{getPostedTime(row)}</td>
                      <td className="p-3 text-slate-400 text-xs">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between py-6 border-t border-slate-800 mt-4">
              <div className="text-sm text-slate-400">
                Page {page} of {totalPages} ({totalCount} total rows)
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  First
                </button>

                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  Previous
                </button>

                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  onChange={(e) => {
                    const newPage = parseInt(e.target.value, 10);
                    if (Number.isNaN(newPage)) return;
                    if (newPage >= 1 && newPage <= totalPages) setPage(newPage);
                  }}
                  className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-center"
                />

                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  Next
                </button>

                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  Last
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
