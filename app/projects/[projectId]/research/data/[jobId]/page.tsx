'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader, SectionCard, StatusChip } from '@/components/ui';
import { getJobTypeLabel } from '@/lib/jobLabels';

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

interface JobRecord {
  id: string;
  type: string;
  payload?: Record<string, any> | null;
}

export default function ResearchDataPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;
  const runId = searchParams.get('runId');
  const researchHubBackHref = `/projects/${projectId}/research-hub${runId ? `?runId=${runId}` : ''}`;

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
  const [searchQuery, setSearchQuery] = useState('');
  const [jobTitle, setJobTitle] = useState('Research Export');
  const [isProductIntelView, setIsProductIntelView] = useState(false);

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

      const [researchResponse, jobsResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/research?${params.toString()}`, {
          cache: 'no-store',
        }),
        fetch(`/api/projects/${projectId}/jobs`, {
          cache: 'no-store',
        }),
      ]);
      const data = await researchResponse.json();
      const jobsData = await jobsResponse.json().catch(() => ({}));
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

      const allJobs = Array.isArray(jobsData?.jobs) ? (jobsData.jobs as JobRecord[]) : [];
      const matchedJob = allJobs.find((job) => job.id === jobId) ?? null;
      if (matchedJob) {
        setJobTitle(`${getJobTypeLabel(matchedJob.type)} Export`);
        setIsProductIntelView(matchedJob.type === 'PRODUCT_DATA_COLLECTION');
      } else {
        setJobTitle('Research Export');
        setIsProductIntelView(false);
      }
    } catch (error) {
      console.error('Failed to load research data:', error);
    } finally {
      setLoading(false);
    }
  }, [
    jobId,
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
    solutionKeywordFilter;

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
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line px-8 py-6">
        <PageHeader
          backHref={researchHubBackHref}
          backLabel="Back to Research Hub"
          title={jobTitle}
          description={
            runId
              ? `Active run: ${runId.substring(0, 8)} | ${totalCount} rows captured`
              : `Loading research... | ${totalCount} rows captured`
          }
          actions={
            <>
              <Link
                href={`/projects/${projectId}/research/data/${jobId}/inputs${runId ? `?runId=${runId}` : ''}`}
                className="btn btn-secondary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest"
              >
                Input Parameters
              </Link>
              <button
                onClick={handleExport}
                className="btn btn-primary !min-h-[36px] px-4 text-label font-bold uppercase tracking-widest"
              >
                Export CSV
              </button>
            </>
          }
        />
      </div>

      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <div className={`grid grid-cols-1 gap-6 ${isProductIntelView ? 'md:grid-cols-1' : 'md:grid-cols-4'}`}>
          <SectionCard className="space-y-2">
            <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Capture Count</p>
            <div className="text-3xl font-bold text-white">{stats.totalRows}</div>
          </SectionCard>
          {!isProductIntelView && (
            <>
              <SectionCard className="space-y-2">
                <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Communities</p>
                <div className="text-3xl font-bold text-accent-2">{stats.uniqueSubreddits}</div>
              </SectionCard>
              <SectionCard className="space-y-2">
                <p className="text-label font-mono text-muted uppercase tracking-widest opacity-40">Average Score</p>
                <div className="flex items-end gap-2">
                  <div className="text-3xl font-bold text-white">{stats.avgScore.toFixed(1)}</div>
                  <div className="text-label font-mono text-muted mb-1.5 uppercase tracking-widest">Score</div>
                </div>
              </SectionCard>
              <SectionCard className="space-y-2 border-accent/20">
                <p className="text-label font-mono text-accent uppercase tracking-widest opacity-60">Primary Keyword</p>
                <div className="text-xl font-bold text-white truncate">{stats.topKeyword}</div>
                <p className="text-label-sm font-mono text-muted/40 uppercase tracking-widest">{stats.topKeywordCount} matched rows</p>
              </SectionCard>
            </>
          )}
        </div>

        {!isProductIntelView && keywordStats.length > 0 && (
          <SectionCard className="space-y-4">
            <p className="card-label font-bold">Keyword Persistence</p>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {keywordStats.map((stat) => (
                <div key={stat.keyword} className="flex flex-col gap-1 p-3 rounded bg-bg-elevated border border-line/20 hover:border-accent/30 transition-colors group">
                  <div className="flex items-center justify-between">
                    <span className="text-label font-mono text-accent uppercase tracking-widest">{stat.keyword}</span>
                    <span className="text-label-sm font-mono text-muted/40 uppercase font-bold">{stat.count} Rows</span>
                  </div>
                  <div className="text-sm font-bold text-white group-hover:text-accent transition-colors">
                    {stat.avgScore.toFixed(1)} <span className="text-label-sm font-mono text-muted font-normal uppercase tracking-widest ml-1">Avg Score</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="card-label font-bold">Research Filters</p>
            <div className="text-label-sm font-mono text-muted/40 uppercase tracking-[0.2em]">
               Showing {filteredRows.length} of {rows.length} loaded
            </div>
          </div>
          
          <div className={`grid grid-cols-1 gap-4 ${isProductIntelView ? 'md:grid-cols-3' : 'md:grid-cols-3 lg:grid-cols-5'}`}>
            <div className="space-y-1.5 text-label-sm font-mono text-muted uppercase tracking-widest ml-1">Source Type</div>
            <div className="space-y-1.5 text-label-sm font-mono text-muted uppercase tracking-widest ml-1">Entity Type</div>
            {!isProductIntelView && (
              <>
                <div className="space-y-1.5 text-label-sm font-mono text-muted uppercase tracking-widest ml-1">Subreddit</div>
                <div className="space-y-1.5 text-label-sm font-mono text-muted uppercase tracking-widest ml-1">Keyword</div>
              </>
            )}
            <div className="space-y-1.5 text-label-sm font-mono text-muted uppercase tracking-widest ml-1">Search</div>
          </div>

          <div className={`grid grid-cols-1 gap-4 -mt-4 ${isProductIntelView ? 'md:grid-cols-3' : 'md:grid-cols-3 lg:grid-cols-5'}`}>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full bg-bg-elevated border border-line rounded px-3 py-2 text-body-sm font-mono text-white focus:border-accent/40 outline-none transition-colors"
            >
              <option value="all">All Sources</option>
              <option value="reddit">REDDIT</option>
              <option value="amazon">AMAZON</option>
              <option value="uploaded">UPLOADED</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full bg-bg-elevated border border-line rounded px-3 py-2 text-body-sm font-mono text-white focus:border-accent/40 outline-none transition-colors"
            >
              <option value="all">All Types</option>
              <option value="post">POSTS</option>
              <option value="comment">COMMENTS</option>
              <option value="review">REVIEWS</option>
              <option value="UPLOADED">UPLOADED</option>
            </select>

            {!isProductIntelView && (
              <>
                <select
                  value={subredditFilter}
                  onChange={(e) => {
                    setSubredditFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-bg-elevated border border-line rounded px-3 py-2 text-body-sm font-mono text-white focus:border-accent/40 outline-none transition-colors"
                >
                  <option value="">All Subreddits</option>
                  {uniqueSubreddits.map((s) => (
                    <option key={s} value={s}>{s.toUpperCase()}</option>
                  ))}
                </select>

                <select
                  value={solutionKeywordFilter}
                  onChange={(e) => {
                    setSolutionKeywordFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-bg-elevated border border-line rounded px-3 py-2 text-body-sm font-mono text-white focus:border-accent/40 outline-none transition-colors"
                >
                  <option value="">All Keywords</option>
                  {uniqueKeywords.map((k) => (
                    <option key={k} value={k}>{k.toUpperCase()}</option>
                  ))}
                </select>
              </>
            )}

            <input
              type="text"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-elevated border border-line rounded px-3 py-2 text-body-sm font-mono text-white focus:border-accent/40 outline-none transition-colors placeholder:text-muted/20"
            />
          </div>
        </SectionCard>

        {filtersActive && (
          <div className="rounded border border-accent/20 bg-accent/5 p-4 flex items-center gap-3">
             <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
             <p className="text-label font-mono text-accent uppercase tracking-widest font-bold">
               Active filters: <span className="text-white opacity-60">Server-side query and client-side filtering are active.</span>
             </p>
          </div>
        )}

        {loading ? (
          <SectionCard padding="none" className="p-20 flex flex-col items-center justify-center space-y-4">
             <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
             <p className="text-label font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Loading research rows...</p>
          </SectionCard>
        ) : (
          <SectionCard padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm border-collapse">
                <thead>
                  <tr className="bg-bg-elevated border-b border-line">
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Type</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold whitespace-nowrap">Source</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Subreddit</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Keyword</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Content</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Intensity</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Trace ID</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold">Posted</th>
                    <th className="text-left p-4 font-mono text-muted uppercase tracking-widest font-bold whitespace-nowrap">Capture Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/30">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/5 transition-colors group align-top">
                      <td className="p-4">
                        <StatusChip variant={
                          getDisplayType(row) === 'review'
                            ? 'success'
                            : getDisplayType(row) === 'post'
                              ? 'info'
                              : 'subtle'
                        } className="!text-label-xs !px-1.5 !py-0 !h-4 uppercase tracking-widest">
                          {getDisplayType(row)}
                        </StatusChip>
                      </td>
                      <td className="p-4">
                         <div className="font-mono text-muted uppercase group-hover:text-accent-2 transition-colors">
                           {getDisplaySource(row)}
                         </div>
                      </td>
                      <td className="p-4">
                        <div className="font-mono text-accent-2 uppercase group-hover:text-white transition-colors">
                          {row.subreddit ? `r/${row.subreddit}` : '—'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          {row.solutionKeyword && (
                            <div className="text-label font-mono text-accent uppercase tracking-tight">{row.solutionKeyword}</div>
                          )}
                          {row.problemKeyword && (
                            <div className="text-label-sm font-mono text-muted uppercase tracking-tight opacity-40">{row.problemKeyword}</div>
                          )}
                        </div>
                      </td>
                      <td className="p-4 max-w-md">
                        <p className="text-muted leading-relaxed group-hover:text-white transition-colors">
                          {row.content.substring(0, 180)}
                          {row.content.length > 180 && '...'}
                        </p>
                      </td>
                      <td className="p-4">
                        <div className="font-mono font-bold text-white">
                          {getDisplayScore(row)}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-mono text-muted uppercase opacity-40 hover:opacity-100 transition-opacity">
                          {row.redditId || '—'}
                        </div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <div className="font-mono text-muted uppercase">
                          {getPostedTime(row)}
                        </div>
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <div className="font-mono text-muted/40 uppercase">
                          {new Date(row.createdAt).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}<br/>
                          {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-6 border-t border-line bg-bg-elevated">
              <div className="text-label font-mono text-muted uppercase tracking-[0.2em]">
                Page <span className="text-white">{page}</span> OF <span className="text-white">{totalPages}</span> 
                <span className="mx-3 opacity-20">|</span> 
                <span className="text-white">{totalCount}</span> NODES_IN_STORAGE
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="btn btn-secondary !min-h-[32px] px-3 !text-label-sm uppercase tracking-widest disabled:opacity-20"
                >
                  First
                </button>

                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  className="btn btn-secondary !min-h-[32px] px-3 !text-label-sm uppercase tracking-widest disabled:opacity-20"
                >
                  Prev
                </button>

                <div className="flex items-center bg-bg border border-line rounded p-1">
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
                    className="w-12 bg-transparent text-center font-mono text-body-sm text-white outline-none"
                  />
                </div>

                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="btn btn-secondary !min-h-[32px] px-3 !text-label-sm uppercase tracking-widest disabled:opacity-20"
                >
                  Next
                </button>

                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  className="btn btn-secondary !min-h-[32px] px-3 !text-label-sm uppercase tracking-widest disabled:opacity-20"
                >
                  Last
                </button>
              </div>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
