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

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Research Run Data</h1>
            <p className="text-sm text-slate-400">
              Run ID: <span className="text-slate-200">{runId || "N/A"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadJobs()}
              disabled={loading || deleting}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Back to Research Hub
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              disabled={loading || deleting || jobs.length === 0}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {allSelected ? "Clear Selection" : "Select All"}
            </button>
            <button
              type="button"
              onClick={() => void deleteJobs("selected")}
              disabled={loading || deleting || selectedIds.length === 0}
              className="rounded-lg border border-red-500/60 bg-red-900/40 px-3 py-2 text-sm text-red-200 hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete Selected ({selectedIds.length})
            </button>
            <button
              type="button"
              onClick={() => void deleteJobs("all")}
              disabled={loading || deleting || jobs.length === 0}
              className="rounded-lg border border-red-500/80 bg-red-900/50 px-3 py-2 text-sm text-red-100 hover:bg-red-900/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete All Research Jobs
            </button>
            <span className="ml-auto text-xs text-slate-400">
              {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </span>
          </div>
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/90">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Select</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Job</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Created</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Updated</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Job ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Loading research jobs...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No research jobs found for this run.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedJobIds[job.id])}
                        onChange={() => toggleOne(job.id)}
                        disabled={deleting}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-200">
                      {getResearchJobLabel(job)}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{job.status}</td>
                    <td className="px-3 py-2 text-slate-400">{formatDate(job.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-400">{formatDate(job.updatedAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{job.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
