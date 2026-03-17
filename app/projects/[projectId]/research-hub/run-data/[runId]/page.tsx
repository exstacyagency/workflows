"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { JobStatus, JobType } from "@prisma/client";
import { getJobTypeLabel } from "@/lib/jobLabels";

type ResearchJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  error?: unknown;
  createdAt: string;
  updatedAt: string;
  runId?: string | null;
  payload?: Record<string, unknown> | null;
  resultSummary?: unknown;
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getResearchJobLabel(job: ResearchJob): string {
  if (job.type === JobType.AD_PERFORMANCE) {
    const subtype = String(job.payload?.jobType || "").trim();
    if (subtype === "ad_ocr_collection") return "Ad OCR";
    if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
      return "Ad Transcripts";
    }
    return "Ad Collection";
  }

  return getJobTypeLabel(job.type);
}

export default function ResearchRunDataPage() {
  const params = useParams();
  const projectId = String(params?.projectId ?? "").trim();
  const runId = String(params?.runId ?? "").trim();

  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  const loadJobs = useCallback(async () => {
    if (!projectId || !runId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/research-jobs`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load research run jobs");
      }
      const rows = Array.isArray(data.jobs) ? (data.jobs as ResearchJob[]) : [];
      setJobs(rows);
      setSelectedJobIds((prev) => {
        const next: Record<string, boolean> = {};
        for (const job of rows) {
          if (prev[job.id]) next[job.id] = true;
        }
        return next;
      });
    } catch (err: any) {
      setJobs([]);
      setError(err?.message || "Failed to load research run jobs");
    } finally {
      setLoading(false);
    }
  }, [projectId, runId]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const selectedIds = useMemo(
    () =>
      Object.entries(selectedJobIds)
        .filter(([, checked]) => checked)
        .map(([jobId]) => jobId),
    [selectedJobIds],
  );

  const allSelected = jobs.length > 0 && selectedIds.length === jobs.length;

  function toggleAll() {
    setSelectedJobIds(() => {
      if (allSelected) return {};
      const next: Record<string, boolean> = {};
      for (const job of jobs) {
        next[job.id] = true;
      }
      return next;
    });
  }

  function toggleOne(jobId: string) {
    setSelectedJobIds((prev) => ({
      ...prev,
      [jobId]: !prev[jobId],
    }));
  }

  async function deleteJobs(mode: "selected" | "all") {
    if (!projectId || !runId || deleting) return;
    const deletingSelected = mode === "selected";
    if (deletingSelected && selectedIds.length === 0) return;

    const confirmed = window.confirm(
      deletingSelected
        ? `Delete ${selectedIds.length} selected research job(s)? This cannot be undone.`
        : "Delete ALL research jobs in this run? This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/research-jobs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          deletingSelected ? { jobIds: selectedIds } : { deleteAll: true },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete research jobs");
      }
      setSelectedJobIds({});
      await loadJobs();
    } catch (err: any) {
      setError(err?.message || "Failed to delete research jobs");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
          <p className="text-[10px] font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Syncing_Run_State...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel/50 backdrop-blur-md px-8 py-6">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-4">
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
            >
              ← Back to Research Hub
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold tracking-tight text-white">Run Overview</h1>
              <div className="status-chip subtle uppercase tracking-widest text-[9px]">
                {runId.substring(0, 8)}
              </div>
            </div>
            <p className="text-xs text-muted font-mono uppercase tracking-widest opacity-60">
              Run ID: <span className="text-accent">{runId}</span> 
              <span className="mx-3 opacity-20">|</span> 
              Jobs: <span className="text-accent-2">{jobs.length} Active</span>
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadJobs()}
              disabled={loading || deleting}
              className="btn btn-secondary !min-h-[40px] px-6 text-[10px] font-bold uppercase tracking-widest"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-10 space-y-8 max-w-[1200px] mx-auto">
        <div className="rounded-card border border-line bg-panel/40 p-6 backdrop-blur-panel flex flex-wrap items-center gap-4">
          <button
            onClick={toggleAll}
            disabled={jobs.length === 0}
            className="px-4 py-2 rounded-pill border border-line bg-bg-elevated/50 text-[10px] font-mono text-muted uppercase tracking-widest hover:text-white transition-colors"
          >
            {allSelected ? "Clear Selection" : "Select All Jobs"}
          </button>
          
          <div className="h-4 w-px bg-line/50 mx-2"></div>
          
          <button
            onClick={() => void deleteJobs("selected")}
            disabled={selectedIds.length === 0 || deleting}
            className="px-4 py-2 rounded-pill border border-danger/20 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest hover:bg-danger/10 transition-all font-bold"
          >
            Delete Selected ({selectedIds.length})
          </button>
          
          <button
            onClick={() => void deleteJobs("all")}
            disabled={jobs.length === 0 || deleting}
            className="px-4 py-2 rounded-pill border border-danger/40 bg-danger/10 text-[10px] font-mono text-danger uppercase tracking-widest hover:bg-danger/20 transition-all font-bold"
          >
             Delete All Jobs
          </button>

          {error && (
            <div className="ml-4 px-3 py-1.5 rounded bg-danger/10 border border-danger/20 text-[10px] font-mono text-danger uppercase">
              {error}
            </div>
          )}
        </div>

        <div className="rounded-card border border-line bg-panel overflow-hidden shadow-panel">
          <div className="px-6 py-3 border-b border-line bg-bg-elevated">
            <h2 className="text-[10px] font-mono text-accent uppercase tracking-[0.2em] font-bold">Run Jobs</h2>
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="bg-bg-elevated border-b border-line">
              <tr>
                <th className="p-5 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded-sm bg-panel border-line checked:bg-accent-2 checked:border-accent-2 transition-all cursor-pointer"
                  />
                </th>
                <th className="p-5 text-[9px] font-mono text-accent uppercase tracking-[0.2em]">Job Type</th>
                <th className="p-5 text-[9px] font-mono text-muted uppercase tracking-[0.2em] w-32">Status</th>
                <th className="p-5 text-[9px] font-mono text-muted uppercase tracking-[0.2em] w-48">Created</th>
                <th className="p-5 text-[9px] font-mono text-muted uppercase tracking-[0.2em] w-48">Updated</th>
                <th className="p-5 text-[9px] font-mono text-muted uppercase tracking-[0.2em] w-40">Job ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-[10px] font-mono text-muted uppercase tracking-widest opacity-40">
                    No jobs found for this run
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="bg-panel-row transition-colors group">
                    <td className="p-5">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedJobIds[job.id])}
                        onChange={() => toggleOne(job.id)}
                        className="h-3.5 w-3.5 rounded-sm bg-panel border-line checked:bg-accent-2 checked:border-accent-2 transition-all cursor-pointer"
                        disabled={deleting}
                      />
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[14px] font-black text-accent tracking-tight leading-none">
                          {getResearchJobLabel(job)}
                        </span>
                        <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">
                          {job.type}
                        </span>
                      </div>
                    </td>
                    <td className="p-5">
                      <span className={`status-chip !text-[8.5px] uppercase font-bold tracking-tighter !py-0.5 ${
                        job.status === 'COMPLETED' ? 'success' :
                        job.status === 'FAILED' ? 'danger' :
                        'warning'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="p-5 font-mono text-[10px] text-muted uppercase">{formatDate(job.createdAt)}</td>
                    <td className="p-5 font-mono text-[10px] text-muted uppercase">{formatDate(job.updatedAt)}</td>
                    <td className="p-5 text-[10px] font-mono text-accent-2/40 truncate max-w-[100px] hover:max-w-none transition-all cursor-default">
                      {job.id}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
