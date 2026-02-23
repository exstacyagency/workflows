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
  type: string;
  runId?: string | null;
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

function isRedditSource(row: ResearchRow): boolean {
  return row.source.startsWith('REDDIT_');
}

function isAmazonSource(row: ResearchRow): boolean {
  return row.source.startsWith('AMAZON');
}

function isProductIntelSource(row: ResearchRow): boolean {
  return row.source === 'UPLOADED' && row.type === 'product_intel';
}

function isUploadedUserSource(row: ResearchRow): boolean {
  return row.source === 'UPLOADED' && !isProductIntelSource(row);
}

function isTikTokAdSource(row: ResearchRow): boolean {
  const source = String(row.source || '').toUpperCase();
  const metadata = (row.metadata ?? {}) as Record<string, any>;
  const platform = String(metadata.platform ?? metadata.network ?? metadata.source_platform ?? '').toUpperCase();
  if (source.includes('TIKTOK') || source.includes('APIFY')) return true;
  if (platform.includes('TIKTOK')) return true;
  return false;
}

export default function AllResearchDataPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const jobTypeFromUrl = searchParams.get('jobType');
  const normalizedJobType =
    jobTypeFromUrl === 'PRODUCT_DATA_COLLECTION' || jobTypeFromUrl === 'CUSTOMER_RESEARCH'
      ? jobTypeFromUrl
      : 'CUSTOMER_RESEARCH';
  const isProductDataView = normalizedJobType === 'PRODUCT_DATA_COLLECTION';
  const productIdFromUrl = searchParams.get('productId');
  const productFromUrl = searchParams.get('product');
  const runIdFromUrl = searchParams.get('runId');

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
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const rowsPerPage = 100;

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();
      const jobList = data.jobs || [];

      const productJobs = jobList.filter(
        (j: any) =>
          j.type === normalizedJobType &&
          (!runIdFromUrl || j.runId === runIdFromUrl) &&
          (!productIdFromUrl || j.payload?.productId === productIdFromUrl) &&
          (!productFromUrl || j.payload?.productName === productFromUrl)
      );

      setJobs(productJobs);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  }, [normalizedJobType, productFromUrl, productIdFromUrl, projectId, runIdFromUrl]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * rowsPerPage;
      const params = new URLSearchParams({
        limit: String(rowsPerPage),
        offset: String(offset),
      });
      params.set('jobType', normalizedJobType);
      if (selectedJob !== 'all') {
        params.set('jobId', selectedJob);
      } else if (runIdFromUrl) {
        params.set('runId', runIdFromUrl);
      } else if (productFromUrl) {
        params.set('product', productFromUrl);
      }
      if (productIdFromUrl) {
        params.set('productId', productIdFromUrl);
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
    normalizedJobType,
    page,
    productFromUrl,
    productIdFromUrl,
    projectId,
    rowsPerPage,
    runIdFromUrl,
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

  useEffect(() => {
    setSelectedJob('all');
    setPage(1);
    setSelectedRowIds([]);
  }, [normalizedJobType, productIdFromUrl, productFromUrl, runIdFromUrl]);

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
      if (sourceFilter === 'reddit' && !isRedditSource(row)) return false;
      if (sourceFilter === 'amazon' && !isAmazonSource(row)) return false;
      if (sourceFilter === 'product-intel' && !isProductIntelSource(row)) return false;
      if (sourceFilter === 'uploaded-user' && !isUploadedUserSource(row)) return false;
      if (sourceFilter === 'tiktok-ad' && !isTikTokAdSource(row)) return false;
    }
    if (typeFilter !== 'all' && row.type !== typeFilter) return false;
    if (searchQuery && !row.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const filteredRowIds = useMemo(() => filteredRows.map((row) => row.id), [filteredRows]);
  const allFilteredSelected =
    filteredRowIds.length > 0 && filteredRowIds.every((id) => selectedRowIds.includes(id));
  const selectedCount = selectedRowIds.length;

  useEffect(() => {
    setSelectedRowIds((prev) => prev.filter((id) => filteredRowIds.includes(id)));
  }, [filteredRowIds]);

  async function handleExport() {
    const params = new URLSearchParams();
    params.set('jobType', normalizedJobType);
    if (selectedJob !== 'all') {
      params.set('jobId', selectedJob);
    } else if (runIdFromUrl) {
      params.set('runId', runIdFromUrl);
    }
    if (productIdFromUrl) {
      params.set('productId', productIdFromUrl);
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

  async function handleDeleteDataPoint(rowId: string) {
    if (!window.confirm('Delete this data point? This cannot be undone.')) return;
    setDeletingRowId(rowId);
    try {
      const response = await fetch(`/api/projects/${projectId}/research`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId,
          jobType: normalizedJobType,
          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete data point');
      }
      setRows((prev) => prev.filter((row) => row.id !== rowId));
      setTotalCount((prev) => Math.max(0, prev - 1));
      setSelectedRowIds((prev) => prev.filter((id) => id !== rowId));
      if (expandedRow === rowId) setExpandedRow(null);
    } catch (error: any) {
      alert(error?.message || 'Failed to delete data point');
    } finally {
      setDeletingRowId(null);
    }
  }

  function toggleSelectRow(rowId: string) {
    setSelectedRowIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedRowIds((prev) => prev.filter((id) => !filteredRowIds.includes(id)));
      return;
    }
    setSelectedRowIds((prev) => Array.from(new Set([...prev, ...filteredRowIds])));
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    if (
      !window.confirm(`Delete ${selectedRowIds.length} selected data point(s)? This cannot be undone.`)
    ) {
      return;
    }
    setBulkDeleting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/research`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowIds: selectedRowIds,
          jobType: normalizedJobType,
          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete selected data points');
      }
      await loadData();
      setSelectedRowIds([]);
      setExpandedRow(null);
    } catch (error: any) {
      alert(error?.message || 'Failed to delete selected data points');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDeleteAll() {
    if (
      !window.confirm(
        'Delete all data points matching current filters (job/run/product/subreddit/keyword/min score)? This cannot be undone.'
      )
    ) {
      return;
    }

    setDeletingAll(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/research`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deleteAll: true,
          jobType: normalizedJobType,
          ...(selectedJob !== 'all' ? { jobId: selectedJob } : {}),
          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),
          ...(productIdFromUrl ? { productId: productIdFromUrl } : {}),
          ...(selectedJob === 'all' && !runIdFromUrl && productFromUrl ? { product: productFromUrl } : {}),
          ...(subredditFilter ? { subreddit: subredditFilter } : {}),
          ...(solutionKeywordFilter ? { solutionKeyword: solutionKeywordFilter } : {}),
          ...(minScoreFilter > 0 ? { minScore: minScoreFilter } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete all filtered data points');
      }
      await loadData();
      setSelectedRowIds([]);
      setExpandedRow(null);
    } catch (error: any) {
      alert(error?.message || 'Failed to delete all filtered data points');
    } finally {
      setDeletingAll(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  function getDisplaySource(row: ResearchRow): string {
    if (isRedditSource(row)) return 'Reddit';
    if (isAmazonSource(row)) return 'Amazon';
    if (isTikTokAdSource(row)) return 'TikTok Ad';
    if (isProductIntelSource(row)) return 'Product Intel';
    if (isUploadedUserSource(row)) return 'Uploaded';
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
              {isProductDataView ? 'All Product Data' : 'All Customer Data'} {productFromUrl && `- ${productFromUrl}`}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {totalCount} total rows across {jobs.length} research jobs
              {runIdFromUrl ? (
                <>
                  {' '}· runId: <span className="font-mono">{runIdFromUrl}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedCount === 0 || bulkDeleting || deletingAll}
              className="px-3 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
            >
              {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedCount})`}
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={deletingAll || bulkDeleting || totalCount === 0}
              className="px-3 py-2 bg-rose-900 hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
            >
              {deletingAll ? 'Deleting...' : 'Delete All'}
            </button>
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium"
            >
              Export All CSV
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
            <option value="product-intel">Product Intel</option>
            <option value="uploaded-user">Uploaded</option>
            <option value="tiktok-ad">TikTok Ad</option>
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
                    <th className="text-left p-3 font-medium w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        className="h-4 w-4"
                        aria-label="Select all visible rows"
                      />
                    </th>
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
                            <input
                              type="checkbox"
                              checked={selectedRowIds.includes(row.id)}
                              onChange={() => toggleSelectRow(row.id)}
                              className="h-4 w-4"
                              aria-label={`Select row ${row.id}`}
                            />
                          </td>
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
                            {isRedditSource(row) ? (
                              <span className="font-mono">{getScore(row)}</span>
                            ) : isAmazonSource(row) ? (
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
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                                className="text-xs text-sky-400 hover:text-sky-300 underline text-left"
                              >
                                {isExpanded ? 'Hide' : 'Details'}
                              </button>
                              <button
                                onClick={() => handleDeleteDataPoint(row.id)}
                                disabled={deletingRowId === row.id}
                                className="text-xs text-rose-300 hover:text-rose-200 underline text-left disabled:opacity-50"
                              >
                                {deletingRowId === row.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-slate-800 bg-slate-900/40">
                            <td colSpan={10} className="p-4">
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
