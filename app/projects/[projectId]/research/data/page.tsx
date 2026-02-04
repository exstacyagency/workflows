'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ResearchRow {
  id: string;
  jobId: string | null;
  type: string | null;
  source: string;
  content: string;
  metadata: any;
  createdAt: string;
}

interface Job {
  id: string;
  createdAt: string;
  payload: any;
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
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
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
      const jobParam = selectedJob !== 'all' ? `&jobId=${selectedJob}` : '';
      const productParam = productFromUrl && selectedJob === 'all' ? `&product=${productFromUrl}` : '';
      const response = await fetch(
        `/api/projects/${projectId}/research?limit=${rowsPerPage}&offset=${offset}${jobParam}${productParam}`
      );
      const data = await response.json();
      setRows(data.rows || []);
      setTotalCount(data.total || 0);
    } catch (error) {
      console.error('Failed to load research data:', error);
    } finally {
      setLoading(false);
    }
  }, [page, productFromUrl, projectId, rowsPerPage, selectedJob]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

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

  async function handleExport() {
    const jobParam = selectedJob !== 'all' ? `?jobId=${selectedJob}` : '';
    const response = await fetch(`/api/projects/${projectId}/research/export${jobParam}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-all-${productFromUrl || 'data'}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

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
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="all">All Types</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
            <option value="document">Documents</option>
          </select>

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
          {(sourceFilter !== 'all' || typeFilter !== 'all' || searchQuery) &&
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
                    <th className="text-left p-3 font-medium w-20">Type</th>
                    <th className="text-left p-3 font-medium w-32">Source</th>
                    <th className="text-left p-3 font-medium">Content</th>
                    <th className="text-left p-3 font-medium w-20">Score</th>
                    <th className="text-left p-3 font-medium w-32">Date</th>
                    <th className="text-left p-3 font-medium w-24">Job</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-900/50">
                      <td className="p-3">
                        <span className="px-2 py-1 bg-slate-700 rounded text-xs">
                          {row.type || 'unknown'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 text-xs">
                        {row.source === "UPLOADED"
                          ? row.metadata?.source || "UPLOADED"
                          : row.source}
                      </td>
                      <td className="p-3">
                        {row.content.substring(0, 200)}
                        {row.content.length > 200 && '...'}
                      </td>
                      <td className="p-3 text-slate-400">{(row.metadata as any)?.score || 0}</td>
                      <td className="p-3 text-slate-400 text-xs">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        {row.jobId ? (
                          <Link
                            href={`/projects/${projectId}/research/data/${row.jobId}`}
                            className="text-sky-400 hover:text-sky-300 text-xs underline"
                          >
                            View Job
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
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
