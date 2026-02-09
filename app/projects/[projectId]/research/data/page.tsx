'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface ResearchRow {
  id: string;
  jobId: string | null;
  type: string;
  source: string;
  subreddit?: string | null;
  redditId?: string | null;
  redditParentId?: string | null;
  redditCreatedUtc?: string | null;
  searchQueryUsed?: string | null;
  solutionKeyword?: string | null;
  problemKeyword?: string | null;
  content: string;
  productType?: string | null;
  productAsin?: string | null;
  rating?: number | null;
  productName?: string | null;
  metadata: any;
  createdAt: string;
}

interface Job {
  id: string;
  createdAt: string;
  payload: any;
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

export default function AllResearchDataPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const productFromUrl = searchParams.get('product');

  const [rows, setRows] = useState<ResearchRow[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
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
  const [selectedJob, setSelectedJob] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [subredditFilter, setSubredditFilter] = useState('');
  const [solutionKeywordFilter, setSolutionKeywordFilter] = useState('');
  const [minScoreFilter, setMinScoreFilter] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const rowsPerPage = 100;

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();
      const jobList = data.jobs || [];

      const productJobs = jobList.filter(
        (j: any) =>
          j.type === 'CUSTOMER_RESEARCH' &&
          (!productFromUrl || j.payload?.productName === productFromUrl)
      );

      setJobs(productJobs);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  }, [projectId, productFromUrl]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * rowsPerPage;
      const params = new URLSearchParams({
        limit: String(rowsPerPage),
        offset: String(offset),
      });
      if (selectedJob !== 'all') {
        params.set('jobId', selectedJob);
      } else if (productFromUrl) {
        params.set('product', productFromUrl);
      }
      if (subredditFilter) {
        params.set('subreddit', subredditFilter);
      }
      if (solutionKeywordFilter) {
        params.set('solutionKeyword', solutionKeywordFilter);
      }
      if (minScoreFilter > 0) {
        params.set('minScore', String(minScoreFilter));
      }

      const response = await fetch(
        `/api/projects/${projectId}/research?${params.toString()}`,
        { cache: 'no-store' }
      );
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
      setExpandedRow(null);
    } catch (error) {
      console.error('Failed to load research data:', error);
    } finally {
      setLoading(false);
    }
  }, [
    minScoreFilter,
    page,
    productFromUrl,
    projectId,
    rowsPerPage,
    selectedJob,
    solutionKeywordFilter,
    subredditFilter,
  ]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const uniqueSubreddits = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => row.subreddit).filter((value): value is string => Boolean(value)))
      ).sort(),
    [rows]
  );

  const uniqueKeywords = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => row.solutionKeyword)
            .filter((value): value is string => Boolean(value))
        )
      ).sort(),
    [rows]
  );

  const filteredRows = rows.filter((row) => {
    if (sourceFilter !== 'all') {
      if (sourceFilter === 'reddit' && !row.source.startsWith('REDDIT_')) return false;
      if (sourceFilter === 'amazon' && !row.source.startsWith('AMAZON')) return false;
      if (sourceFilter === 'uploaded' && row.source !== 'UPLOADED' && row.type !== 'UPLOADED') {
        return false;
      }
      if (!['reddit', 'amazon', 'uploaded'].includes(sourceFilter) && row.source !== sourceFilter) return false;
    }
    if (typeFilter !== 'all' && row.type !== typeFilter) return false;
    if (searchQuery && !row.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  async function handleExport() {
    const params = new URLSearchParams();
    if (selectedJob !== 'all') {
      params.set('jobId', selectedJob);
    }
    if (subredditFilter) {
      params.set('subreddit', subredditFilter);
    }
    if (solutionKeywordFilter) {
      params.set('solutionKeyword', solutionKeywordFilter);
    }
    if (minScoreFilter > 0) {
      params.set('minScore', String(minScoreFilter));
    }
    const response = await fetch(`/api/projects/${projectId}/research/export?${params.toString()}`, {
      cache: 'no-store',
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-all-${productFromUrl || 'data'}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  function getDisplaySource(row: ResearchRow): string {
    if (row.source.startsWith('REDDIT_')) return 'Reddit';
    if (row.source.startsWith('AMAZON')) return 'Amazon';
    if (row.source === 'UPLOADED') return row.metadata?.source || 'Uploaded';
    return row.source;
  }

  function getScore(row: ResearchRow): number {
    const metadataScore = Number((row.metadata as any)?.score ?? 0);
    if (!Number.isNaN(metadataScore) && metadataScore > 0) return metadataScore;
    return 0;
  }

  function getRedditUrl(row: ResearchRow): string | null {
    const rawPermalink =
      row.metadata?.raw_reddit_data?.permalink ??
      row.metadata?.permalink ??
      row.metadata?.sourceUrl ??
      row.metadata?.url ??
      null;
    if (!rawPermalink) return null;
    const permalink = String(rawPermalink).trim();
    if (!permalink) return null;
    if (permalink.startsWith('http://') || permalink.startsWith('https://')) {
      return permalink;
    }
    return `https://reddit.com${permalink.startsWith('/') ? '' : '/'}${permalink}`;
  }

  function getPostedDate(row: ResearchRow): Date {
    if (row.redditCreatedUtc) {
      const unix = Number(row.redditCreatedUtc);
      if (Number.isFinite(unix) && unix > 0) {
        return new Date(unix * 1000);
      }
    }
    return new Date(row.createdAt);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href={`/projects/${projectId}/research-hub${productFromUrl ? `?product=${productFromUrl}` : ''}`}
              className="text-sm text-sky-400 hover:text-sky-300 mb-2 inline-block"
            >
              ← Back to Research Hub
            </Link>
            <h1 className="text-2xl font-bold">
              All Research Data {productFromUrl && `- ${productFromUrl}`}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {totalCount} total rows across {jobs.length} research jobs
            </p>
          </div>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium"
          >
            Export All CSV
          </button>
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
            <p className="mt-1 text-sm text-slate-400">Subreddits in loaded page</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-2xl font-semibold">{stats.avgScore.toFixed(1)}</div>
            <p className="mt-1 text-sm text-slate-400">Average upvotes (loaded page)</p>
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
                <div
                  key={stat.keyword}
                  className="flex items-center justify-between rounded border border-slate-800 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-700 px-2 py-1 text-xs">{stat.keyword}</span>
                    <span className="text-sm text-slate-400">{stat.count} rows</span>
                  </div>
                  <div className="font-mono text-sm text-slate-300">
                    {stat.avgScore.toFixed(1)} avg
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4">
          <select
            value={selectedJob}
            onChange={(e) => {
              setSelectedJob(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="all">All Jobs ({jobs.length})</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {new Date(job.createdAt).toLocaleDateString()} - {job.id.substring(0, 8)}
              </option>
            ))}
          </select>

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

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400" htmlFor="minScoreFilter">
              Min Score
            </label>
            <input
              id="minScoreFilter"
              type="number"
              min={0}
              value={minScoreFilter}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setMinScoreFilter(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
                setPage(1);
              }}
              className="w-24 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="all">All Types</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
            <option value="review">Reviews</option>
            <option value="document">Documents</option>
          </select>

          <input
            type="text"
            placeholder="Search content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="col-span-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          />
        </div>

        <div className="mt-3 text-sm text-slate-400">
          Showing {filteredRows.length} of {rows.length} loaded
          {(sourceFilter !== 'all' ||
            typeFilter !== 'all' ||
            searchQuery ||
            subredditFilter ||
            solutionKeywordFilter ||
            minScoreFilter > 0) &&
            ` (${totalCount} total in database)`}
        </div>
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-slate-800">
                <thead className="bg-slate-900 border-b border-slate-700">
                  <tr>
                    <th className="text-left p-3 font-medium w-24">Type</th>
                    <th className="text-left p-3 font-medium w-24">Source</th>
                    <th className="text-left p-3 font-medium w-40">Subreddit</th>
                    <th className="text-left p-3 font-medium w-32">Keyword</th>
                    <th className="text-left p-3 font-medium">Content</th>
                    <th className="text-left p-3 font-medium w-24">Score</th>
                    <th className="text-left p-3 font-medium w-40">Posted</th>
                    <th className="text-left p-3 font-medium w-24">Job</th>
                    <th className="text-left p-3 font-medium w-20">More</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isExpanded = expandedRow === row.id;
                    const redditUrl = getRedditUrl(row);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-b border-slate-800 hover:bg-slate-900/50">
                          <td className="p-3">
                            <span className="px-2 py-1 bg-slate-700 rounded text-xs">
                              {row.type || 'unknown'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-300 text-xs">{getDisplaySource(row)}</td>
                          <td className="p-3 text-xs">
                            {row.subreddit ? (
                              <a
                                href={`https://reddit.com/r/${row.subreddit}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-400 hover:text-sky-300 hover:underline"
                              >
                                r/{row.subreddit}
                              </a>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="p-3 text-xs">
                            {row.solutionKeyword ? (
                              <span className="px-2 py-1 bg-slate-700 rounded text-xs">
                                {row.solutionKeyword}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="max-w-md truncate" title={row.content}>
                              {row.content.slice(0, 150)}
                              {row.content.length > 150 ? '...' : ''}
                            </div>
                            {redditUrl && (
                              <a
                                href={redditUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-xs text-sky-400 hover:text-sky-300 hover:underline"
                              >
                                View on Reddit
                              </a>
                            )}
                          </td>
                          <td className="p-3 text-slate-300">
                            {row.source.startsWith('REDDIT_') ? (
                              <span className="font-mono">{getScore(row)}</span>
                            ) : row.source.startsWith('AMAZON') ? (
                              <span>{row.rating ?? (row.metadata?.rating ?? '—')}/5</span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400 text-xs">
                            {formatDistanceToNow(getPostedDate(row), { addSuffix: true })}
                          </td>
                          <td className="p-3">
                            {row.jobId ? (
                              <div className="flex flex-col gap-1">
                                <Link
                                  href={`/projects/${projectId}/research/data/${row.jobId}`}
                                  className="text-sky-400 hover:text-sky-300 text-xs underline"
                                >
                                  View Job
                                </Link>
                                <Link
                                  href={`/projects/${projectId}/research/data/${row.jobId}/inputs`}
                                  className="text-slate-400 hover:text-slate-300 text-xs underline"
                                >
                                  View Inputs
                                </Link>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                              className="text-xs text-sky-400 hover:text-sky-300 underline"
                            >
                              {isExpanded ? 'Hide' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-slate-800 bg-slate-900/40">
                            <td colSpan={9} className="p-4">
                              <div className="space-y-4">
                                <div>
                                  <h4 className="font-medium mb-2">Full Content</h4>
                                  <p className="whitespace-pre-wrap text-sm text-slate-200">
                                    {row.content}
                                  </p>
                                </div>

                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                  <div>
                                    <h4 className="font-medium mb-2">Search Context</h4>
                                    <dl className="space-y-1 text-sm">
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Query used</dt>
                                        <dd className="font-mono text-right text-xs">
                                          {row.searchQueryUsed || '—'}
                                        </dd>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Solution keyword</dt>
                                        <dd>{row.solutionKeyword || '—'}</dd>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Problem keyword</dt>
                                        <dd>{row.problemKeyword || '—'}</dd>
                                      </div>
                                    </dl>
                                  </div>

                                  <div>
                                    <h4 className="font-medium mb-2">Reddit Details</h4>
                                    <dl className="space-y-1 text-sm">
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Reddit ID</dt>
                                        <dd className="font-mono text-xs">{row.redditId || '—'}</dd>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Parent ID</dt>
                                        <dd className="font-mono text-xs">{row.redditParentId || '—'}</dd>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Post type</dt>
                                        <dd>{row.metadata?.post_type || '—'}</dd>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <dt className="text-slate-400">Top-level comment</dt>
                                        <dd>
                                          {row.metadata?.is_top_level_comment ? 'Yes' : 'No'}
                                        </dd>
                                      </div>
                                    </dl>
                                  </div>
                                </div>

                                <details>
                                  <summary className="cursor-pointer text-sm text-slate-400">
                                    Show raw metadata
                                  </summary>
                                  <pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
                                    {JSON.stringify(row.metadata ?? {}, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
                    if (newPage >= 1 && newPage <= totalPages) {
                      setPage(newPage);
                    }
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
