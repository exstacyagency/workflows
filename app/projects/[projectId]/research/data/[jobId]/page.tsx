'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ResearchRow {
  id: string;
  type: string | null;
  source: string;
  content: string;
  metadata: any;
  createdAt: string;
}

export default function ResearchDataPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const jobId = params.jobId as string;
  const runId = searchParams.get('runId');

  const [rows, setRows] = useState<ResearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const rowsPerPage = 100;
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    console.log('[RawData] params', { projectId, jobId, runId });
  }, [projectId, jobId, runId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * rowsPerPage;
      const runParam = runId ? `&runId=${runId}` : '';
      const url = `/api/projects/${projectId}/research?jobId=${jobId}&limit=${rowsPerPage}&offset=${offset}${runParam}`;
      console.log('[RawData] fetching', { url, page, rowsPerPage, offset, runId });
      const response = await fetch(url);
      console.log('[RawData] response', { status: response.status, ok: response.ok });
      const data = await response.json();
      console.log('[RawData] data', {
        rows: data?.rows?.length ?? 0,
        total: data?.total ?? 0,
        keys: Object.keys(data || {}),
      });
      setRows(data.rows || []);
      setTotalCount(data.total || 0);
    } catch (error) {
      console.error('Failed to load research data:', error);
    } finally {
      setLoading(false);
    }
  }, [jobId, page, projectId, rowsPerPage, runId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = rows.filter((row) => {
    if (sourceFilter !== 'all') {
      if (sourceFilter === 'reddit' && !row.source.startsWith('REDDIT_')) return false;
      if (sourceFilter === 'amazon' && row.source !== 'AMAZON') return false;
      if (sourceFilter === 'uploaded' && row.source !== 'UPLOADED' && row.type !== 'UPLOADED') {
        return false;
      }
    }
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
    if (typeFilter !== 'all' && row.type !== typeFilter) return false;
    if (searchQuery && !row.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const filtersActive = sourceFilter !== 'all' || typeFilter !== 'all' || searchQuery;

  const formatDateTime = (date: string) =>
    new Date(date).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const getDisplayType = (row: ResearchRow) => {
    if (row.source === "UPLOADED" || row.type === "UPLOADED" || row.type === "document") {
      return "uploaded";
    }
    if (row.source === "AMAZON" || row.type === "review") {
      return "review";
    }
    if (row.type) return row.type;
    return "unknown";
  };

  async function handleExport() {
    const response = await fetch(`/api/projects/${projectId}/research/export?jobId=${jobId}`);
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
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="text-sm text-sky-400 hover:text-sky-300 mb-2 inline-block"
            >
              ← Back to Research Hub
            </Link>
            <h1 className="text-2xl font-bold">Raw Research Data</h1>
            <p className="text-sm text-slate-400 mt-1">
              Job: {jobId.substring(0, 8)}
              {runId ? ` | Run: ${runId.substring(0, 8)}` : ""}
              {` | ${totalCount} total rows`}
            </p>
          </div>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-900/30 px-6 py-4">
        <div className="flex gap-4 items-center">
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

          <input
            type="text"
            placeholder="Search content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          />

          <div className="text-sm text-slate-400">
            Showing {filteredRows.length} of {rows.length} loaded
            {filtersActive && ` (${totalCount} total in database)`}
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        {filtersActive && (
          <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 mb-4">
            <p className="text-sm text-amber-300">
              ⚠️ Filters apply only to the {rows.length} rows currently loaded.
              Use pagination to see more results, or export CSV to filter all {totalCount} rows.
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
                    <th className="text-left p-3 font-medium w-48">Source</th>
                    <th className="text-left p-3 font-medium">Content</th>
                    <th className="text-left p-3 font-medium w-24">Score</th>
                    <th className="text-left p-3 font-medium w-40">Scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-800 hover:bg-slate-900/50"
                    >
                      <td className="p-3">
                        <span className="px-2 py-1 bg-slate-700 rounded text-xs">
                          {getDisplayType(row)}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 text-xs">
                        {row.source === "UPLOADED"
                          ? row.metadata?.source || "UPLOADED"
                          : row.source}
                      </td>
                      <td className="p-3 text-slate-400 text-xs">{row.source}</td>
                      <td className="p-3">{row.content}</td>
                      <td className="p-3 text-slate-400">
                        {(row.metadata as any)?.score || 0}
                      </td>
                      <td className="p-3 text-slate-400 text-xs">
                        {formatDateTime(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!loading && (
              <div className="flex items-center justify-between py-6 border-t border-slate-800">
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

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-400">Go to page:</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={page}
                      onChange={(e) => {
                        const newPage = parseInt(e.target.value, 10);
                        if (Number.isNaN(newPage)) return;
                        if (newPage >= 1 && newPage <= totalPages) {
                          setPage(newPage);
                        }
                      }}
                      className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-center"
                    />
                  </div>

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
            )}
          </>
        )}
      </div>
    </div>
  );
}
