'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader, SectionCard, StatusChip } from '@/components/ui';

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

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
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
      }),
    [rows, searchQuery, sourceFilter, typeFilter]
  );

  const filteredRowIds = useMemo(() => filteredRows.map((row) => row.id), [filteredRows]);
  const allFilteredSelected =
    filteredRowIds.length > 0 && filteredRowIds.every((id) => selectedRowIds.includes(id));
  const selectedCount = selectedRowIds.length;

  useEffect(() => {
    const filteredSet = new Set(filteredRowIds);
    setSelectedRowIds((prev) => {
      const next = prev.filter((id) => filteredSet.has(id));
      return next.length === prev.length ? prev : next;
    });
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
    <div className="min-h-screen bg-bg text-text space-y-8 px-8 py-8">
      {/* Header */}
      <div className="border-b border-line bg-panel backdrop-blur-panel -mx-8 -mt-8 px-8 py-6 sticky top-0 z-30">
        <PageHeader
          backHref={`/projects/${projectId}/research-hub${productFromUrl ? `?product=${productFromUrl}` : ''}`}
          backLabel="Back to Research Hub"
          eyebrow="Context Cluster"
          title={`${isProductDataView ? 'Product Intel' : 'Customer Synthesis'}${productFromUrl ? ` [${productFromUrl}]` : ''}`}
          description={`${totalCount} datapoints | ${jobs.length} cycles${runIdFromUrl ? ` | Batch: ${runIdFromUrl.slice(0, 8)}` : ''}`}
          actions={
            <>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedCount === 0 || bulkDeleting || deletingAll}
                className="px-4 py-2 rounded-pill border border-danger/20 bg-danger/5 text-danger font-mono font-bold uppercase tracking-widest text-label-sm hover:bg-danger/10 hover:text-danger disabled:opacity-20 transition-all"
              >
                {bulkDeleting ? 'Purging...' : `Purge (${selectedCount})`}
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll || bulkDeleting || totalCount === 0}
                className="px-4 py-2 rounded-pill border border-danger/40 bg-danger/10 text-danger font-mono font-bold uppercase tracking-widest text-label-sm hover:bg-danger/20 disabled:opacity-20 transition-all"
              >
                {deletingAll ? 'Wiping...' : 'Wipe Database'}
              </button>
              <button
                onClick={handleExport}
                className="btn btn-primary px-6 py-2.5 text-label font-bold uppercase tracking-[0.2em]"
              >
                Export Schema
              </button>
            </>
          }
        />
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 pt-4">
        <SectionCard className="group hover:border-accent-2/30 transition-colors">
          <div className="text-3xl font-black text-white tracking-tighter">{stats.totalRows}</div>
          <p className="mt-2 text-label-sm font-mono text-muted uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">Global Dataset Integrity</p>
        </SectionCard>
        <SectionCard className="group hover:border-accent-2/30 transition-colors">
          <div className="text-3xl font-black text-white tracking-tighter">{stats.uniqueSubreddits}</div>
          <p className="mt-2 text-label-sm font-mono text-muted uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">Source Node Diversity</p>
        </SectionCard>
        <SectionCard className="group hover:border-accent-2/30 transition-colors">
          <div className="text-3xl font-black text-white tracking-tighter">{stats.avgScore.toFixed(1)}</div>
          <p className="mt-2 text-label-sm font-mono text-muted uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">Avg Content Resonance</p>
        </SectionCard>
        <SectionCard className="group hover:border-accent/30 transition-colors">
          <div className="text-3xl font-black text-accent tracking-tighter truncate">{stats.topKeyword}</div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-label-sm font-mono text-muted uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">Top Theme</p>
            <span className="text-label-sm font-mono text-accent uppercase tracking-widest">{stats.topKeywordCount} Hits</span>
          </div>
        </SectionCard>
      </div>

      {keywordStats.length > 0 && (
        <SectionCard padding="lg">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-line/50"></div>
            <h2 className="text-label font-mono font-bold text-muted uppercase tracking-[0.4em] opacity-50">Theme Breakdown</h2>
            <div className="h-px flex-1 bg-line/50"></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {keywordStats.map((stat) => (
              <div
                key={stat.keyword}
                className="flex items-center justify-between rounded-card border border-line/50 bg-bg-elevated px-5 py-3 hover:bg-bg-elevated transition-all group cursor-default"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-black text-white tracking-tight leading-none">{stat.keyword}</span>
                  <span className="text-label-sm font-mono text-muted uppercase tracking-widest opacity-40 group-hover:opacity-60 transition-opacity">{stat.count} Occurrences</span>
                </div>
                <div className="font-mono text-body-xs font-black text-accent-2 opacity-60 group-hover:opacity-100 transition-opacity group-hover:scale-110">
                  {stat.avgScore.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Filters Hub */}
      <div className="space-y-6 pt-4">
        <div className="flex items-center gap-4">
          <h2 className="text-label font-mono font-bold text-muted uppercase tracking-[0.3em] opacity-60">Research Filters</h2>
          <div className="h-px flex-1 bg-line/30"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="relative group">
            <select
              value={selectedJob}
              onChange={(e) => {
                setSelectedJob(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white outline-none focus:border-accent/40 transition-colors appearance-none cursor-pointer hover:bg-bg-elevated"
            >
              <option value="all">RUN: ALL ({jobs.length})</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {new Date(job.createdAt).toLocaleDateString()} · {job.id.substring(0, 8)}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 inset-y-0 flex items-center text-label-xs text-muted/20 group-hover:text-muted">▼</span>
          </div>

          <div className="relative group">
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full px-4 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white outline-none focus:border-accent/40 transition-colors appearance-none cursor-pointer hover:bg-bg-elevated"
            >
              <option value="all">SOURCE: ALL</option>
              <option value="reddit">REDDIT NETWORK</option>
              <option value="amazon">AMAZON MARKET</option>
              <option value="product-intel">PRODUCT INTEL</option>
              <option value="uploaded-user">USER CONTEXT</option>
              <option value="tiktok-ad">TIKTOK AD SETS</option>
            </select>
            <span className="pointer-events-none absolute right-3 inset-y-0 flex items-center text-label-xs text-muted/20 group-hover:text-muted">▼</span>
          </div>

          <div className="relative group">
            <select
              value={subredditFilter}
              onChange={(e) => {
                setSubredditFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white outline-none focus:border-accent/40 transition-colors appearance-none cursor-pointer hover:bg-bg-elevated"
            >
              <option value="">COMMUNITY: ALL</option>
              {uniqueSubreddits.map((subreddit) => (
                <option key={subreddit} value={subreddit}>
                  r/{subreddit.toUpperCase()}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 inset-y-0 flex items-center text-label-xs text-muted/20 group-hover:text-muted">▼</span>
          </div>

          <div className="relative group">
            <select
              value={solutionKeywordFilter}
              onChange={(e) => {
                setSolutionKeywordFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-4 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white outline-none focus:border-accent/40 transition-colors appearance-none cursor-pointer hover:bg-bg-elevated"
            >
              <option value="">ANGLE: ALL</option>
              {uniqueKeywords.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {keyword.toUpperCase()}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 inset-y-0 flex items-center text-label-xs text-muted/20 group-hover:text-muted">▼</span>
          </div>

          <div className="flex items-center gap-4 px-5 py-3 bg-panel border border-line rounded-card group focus-within:border-accent/40 transition-colors">
            <label className="text-label-sm font-mono text-muted uppercase tracking-widest opacity-50 group-hover:opacity-100 transition-opacity" htmlFor="minScoreFilter">
              SCORE
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
              className="w-full bg-transparent border-none text-body-sm font-mono text-white outline-none font-bold placeholder:text-muted/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative group">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-4 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white outline-none focus:border-accent/40 transition-colors appearance-none cursor-pointer hover:bg-bg-elevated"
            >
              <option value="all">FORMAT: ALL</option>
              <option value="post">POSTS</option>
              <option value="comment">COMMENTS</option>
              <option value="review">REVIEWS</option>
              <option value="document">DOCUMENTS</option>
            </select>
            <span className="pointer-events-none absolute right-3 inset-y-0 flex items-center text-label-xs text-muted/20 group-hover:text-muted">▼</span>
          </div>

          <div className="relative md:col-span-3 group">
            <input
              type="text"
              placeholder="SEARCH RESEARCH..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-12 py-3 bg-panel border border-line rounded-card text-body-sm font-mono text-white placeholder:text-muted/20 outline-none focus:border-accent/40 transition-colors hover:bg-bg-elevated"
            />
            <span className="pointer-events-none absolute left-5 inset-y-0 flex items-center text-label font-mono text-muted/20">SEARCH:</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-label font-mono text-muted uppercase tracking-[0.2em] opacity-40 px-1 border-t border-line/5 py-4">
        <div>
          Showing {filteredRows.length} of {rows.length} research rows
          {(sourceFilter !== 'all' ||
            typeFilter !== 'all' ||
            searchQuery ||
            subredditFilter ||
            solutionKeywordFilter ||
            minScoreFilter > 0) &&
            ` · Integrated DB Total: ${totalCount}`}
        </div>
        <div className="flex items-center gap-6">
          <span className="text-accent-2 font-bold tracking-widest">CLUSTER {page} / {totalPages}</span>
        </div>
      </div>

      <div className="space-y-6 pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-40 space-y-4">
            <div className="w-12 h-12 border-2 border-accent-2/10 border-t-accent-2 rounded-full animate-spin"></div>
            <div className="text-label font-mono text-muted uppercase tracking-[0.4em] animate-pulse">Loading research context...</div>
          </div>
        ) : (
          <>
            <SectionCard padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-bg-elevated border-b border-line shadow-sm">
                    <tr>
                      <th className="p-5 w-10">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAllFiltered}
                          className="h-3.5 w-3.5 rounded-sm bg-panel border-line checked:bg-accent-2 checked:border-accent-2 transition-all cursor-pointer"
                        />
                      </th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-24">ENTITY TYPE</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-24">SOURCE NODE</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-44">CONTEXT HUB</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-32">SIGNAL TAG</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest">CONTENT FRAGMENT</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-24 text-right">MAGNITUDE</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-32">TIMESTAMP</th>
                      <th className="p-5 text-body-xs font-mono text-muted uppercase tracking-widest w-20 text-center">METRIC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/30">
                    {filteredRows.map((row) => {
                      const isExpanded = expandedRow === row.id;
                      const redditUrl = getRedditUrl(row);
                      return (
                        <Fragment key={row.id}>
                          <tr className={`hover:bg-bg-elevated transition-all group ${isExpanded ? 'bg-bg-elevated' : ''}`}>
                            <td className="p-5">
                              <input
                                type="checkbox"
                                checked={selectedRowIds.includes(row.id)}
                                onChange={() => toggleSelectRow(row.id)}
                                className="h-3.5 w-3.5 rounded-sm bg-panel border-line checked:bg-accent-2 checked:border-accent-2 transition-all cursor-pointer"
                              />
                            </td>
                            <td className="p-5">
                              <span className="status-chip info !py-0.5 !text-label-xs font-black uppercase tracking-tighter opacity-80 group-hover:opacity-100 transition-opacity">
                                {row.type || 'RAW'}
                              </span>
                            </td>
                            <td className="p-5 text-muted text-label font-mono uppercase tracking-widest opacity-60 group-hover:opacity-80 transition-opacity">{getDisplaySource(row)}</td>
                            <td className="p-5">
                              {row.subreddit ? (
                                <a
                                  href={`https://reddit.com/r/${row.subreddit}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-accent-2/70 hover:text-white transition-colors text-body-xs font-black tracking-tight flex items-center gap-2 group/link"
                                >
                                  r/{row.subreddit.toUpperCase()}
                                  <span className="text-label opacity-0 group-hover/link:opacity-40 transition-opacity">↗</span>
                                </a>
                              ) : (
                                <span className="text-muted/20">—</span>
                              )}
                            </td>
                            <td className="p-5">
                              {row.solutionKeyword ? (
                                <span className="text-accent font-black text-body-sm tracking-tight border-b border-accent/20">
                                  {row.solutionKeyword}
                                </span>
                              ) : (
                                <span className="text-muted/20">—</span>
                              )}
                            </td>
                            <td className="p-5">
                              <div 
                                className="max-w-lg text-sm text-text/90 leading-relaxed line-clamp-2 cursor-pointer group-hover:text-white transition-colors"
                                onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                                title={row.content}
                              >
                                {row.content}
                              </div>
                              <div className="flex items-center gap-4 mt-2">
                                {redditUrl && (
                                  <a
                                    href={redditUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-label-sm font-mono font-bold text-accent-2/40 uppercase tracking-widest hover:text-accent-2 transition-all flex items-center gap-1.5"
                                  >
                                    <span className="text-sm">◈</span> Source Node
                                  </a>
                                )}
                                <button
                                  onClick={() => handleDeleteDataPoint(row.id)}
                                  disabled={deletingRowId === row.id}
                                  className="text-label-sm font-mono font-bold text-muted uppercase tracking-widest hover:text-danger transition-all opacity-0 group-hover:opacity-100"
                                >
                                  Purge Data
                                </button>
                              </div>
                            </td>
                            <td className="p-5 text-right">
                              {isRedditSource(row) ? (
                                <div className="inline-flex flex-col items-end">
                                  <div className="flex items-center gap-1.5 font-mono font-black text-white text-sm">
                                    <span className="text-accent-2/40 text-label">RESO.</span>
                                    {getScore(row)}
                                  </div>
                                </div>
                              ) : isAmazonSource(row) ? (
                                <div className="inline-flex items-baseline gap-1 bg-transparent py-1 px-2.5 rounded border border-line">
                                  <span className="text-accent font-black text-body-xs">{row.rating ?? (row.metadata?.rating ?? '—')}</span>
                                  <span className="text-label-xs text-muted opacity-40 font-bold tracking-widest">/ 5.0</span>
                                </div>
                              ) : (
                                <span className="text-muted/20">—</span>
                              )}
                            </td>
                            <td className="p-5 text-muted font-mono text-label-sm uppercase tracking-widest opacity-60">
                              {formatDistanceToNow(getPostedDate(row), { addSuffix: true })}
                            </td>
                            <td className="p-5 text-center">
                              {row.jobId ? (
                                <Link
                                  href={`/projects/${projectId}/research/data/${row.jobId}`}
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-card border border-line bg-bg-elevated hover:bg-accent-2 hover:border-accent-2 group/job transition-all"
                                  title="View Parent Job"
                                >
                                  <span className="text-label font-mono text-white group-hover/job:text-bg font-black">ID</span>
                                </Link>
                              ) : (
                                <span className="text-muted/20">—</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="bg-bg-elevated border-b border-line p-10">
                                <div className="max-w-5xl mx-auto space-y-10">
                                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                                    <div className="lg:col-span-2 space-y-4">
                                      <div className="flex items-center gap-3">
                                        <div className="h-2 w-2 rounded-full bg-accent animate-pulse"></div>
                                        <h4 className="text-label font-mono text-accent uppercase tracking-[0.3em] font-black">Extracted Semantic Payload</h4>
                                      </div>
                                      <div className="text-base text-text/95 leading-relaxed font-sans bg-panel p-8 rounded-card border border-line shadow-inner overflow-hidden">
                                        <div className="overflow-x-auto">
                                          <p className="whitespace-pre-wrap break-words">{row.content}</p>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="space-y-6">
                                      <div className="space-y-4">
                                        <h4 className="text-label font-mono text-accent-2 uppercase tracking-[0.3em] font-black">Row Metadata</h4>
                                        <div className="bg-panel p-6 rounded-card border border-line overflow-hidden group/meta">
                                          <pre className="text-body-sm text-muted-2 leading-loose font-mono max-h-[400px] overflow-y-auto overflow-x-auto custom-scrollbar">
                                            {JSON.stringify(row.metadata, null, 2)}
                                          </pre>
                                        </div>
                                      </div>
                                      <div className="p-6 rounded-card border border-accent-2/10 bg-accent-2/5 space-y-4">
                                        <h4 className="text-label-sm font-mono text-accent-2/60 uppercase tracking-widest font-black">System Actions</h4>
                                        <div className="flex flex-col gap-2">
                                          <Link 
                                            href={`/projects/${projectId}/research/data/${row.jobId}/inputs`}
                                            className="px-4 py-2 bg-panel border border-line rounded text-label font-mono text-muted hover:text-white hover:border-accent-2/40 transition-all uppercase tracking-widest text-center"
                                          >
                                            Inspect Inputs
                                          </Link>
                                          {redditUrl && (
                                            <a 
                                              href={redditUrl}
                                              target="_blank" 
                                              rel="noreferrer"
                                              className="px-4 py-2 bg-accent-2/10 border border-accent-2/20 rounded text-label font-mono text-accent-2 hover:bg-accent-2/20 transition-all uppercase tracking-widest text-center"
                                            >
                                              External Context
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
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
            </SectionCard>

            <div className="flex flex-wrap items-center justify-between gap-6 pt-10">
              <div className="flex items-center gap-3 text-label font-mono text-muted uppercase tracking-[0.4em] opacity-30">
                <span>Research Results</span>
                <span className="hidden sm:inline">|</span>
                <span className="hidden sm:inline pb-0.5">Kairos Research Kernel v4.6</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-6 py-2.5 rounded border border-line bg-panel text-label font-mono text-white disabled:opacity-20 uppercase tracking-widest font-black hover:bg-bg-elevated transition-all"
                >
                  PREV CLUSTER
                </button>
                <div className="w-16 h-10 flex items-center justify-center font-mono text-sm font-black text-white bg-bg-elevated rounded border border-line">
                  {page}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-6 py-3 rounded border border-accent-2/20 bg-accent-2/5 text-label font-mono text-accent-2 hover:bg-accent-2/10 disabled:opacity-20 uppercase tracking-widest font-black transition-all"
                >
                  NEXT CLUSTER
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
