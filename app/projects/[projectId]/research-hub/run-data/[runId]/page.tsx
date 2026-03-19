"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, PageHeader, SectionCard, StatusChip } from "@/components/ui";
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
          <p className="text-label font-mono text-muted uppercase tracking-[0.3em] animate-pulse">Loading run data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel backdrop-blur-md px-8 py-6">
        <PageHeader
          backHref={`/projects/${projectId}/research-hub`}
          backLabel="Back to Research Hub"
          title="Run Overview"
          description={`Run ID: ${runId} | Jobs: ${jobs.length} Active`}
          actions={
            <>
              <StatusChip variant="subtle">{runId.substring(0, 8)}</StatusChip>
              <button
                onClick={() => void loadJobs()}
                disabled={loading || deleting}
                className="btn btn-secondary !min-h-[40px] px-6 text-label font-bold uppercase tracking-widest"
              >
                Refresh
              </button>
            </>
          }
        />
      </div>

      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <SectionCard className="flex flex-wrap items-center gap-4" padding="md">
          <button
            onClick={toggleAll}
            disabled={jobs.length === 0}
            className="btn btn-secondary !min-h-[32px] px-4 text-label"
          >
            {allSelected ? "Clear Selection" : "Select All Jobs"}
          </button>
          
          <div className="h-4 w-px bg-line/50 mx-2"></div>
          
          <button
            onClick={() => void deleteJobs("selected")}
            disabled={selectedIds.length === 0 || deleting}
            className="btn btn-danger !min-h-[32px] px-4 text-label"
          >
            Delete Selected ({selectedIds.length})
          </button>
          
          <button
            onClick={() => void deleteJobs("all")}
            disabled={jobs.length === 0 || deleting}
            className="btn btn-danger !min-h-[32px] px-4 text-label"
          >
             Delete All Jobs
          </button>

          {error && (
            <StatusChip variant="danger" className="ml-4">{error}</StatusChip>
          )}
        </SectionCard>

        <SectionCard padding="none" className="overflow-hidden">
          <div className="px-6 py-3 border-b border-line bg-bg-elevated">
            <p className="eyebrow !mb-0">Run Jobs</p>
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
                <th className="p-5 text-label-sm font-mono text-accent uppercase tracking-[0.2em]">Job Type</th>
                <th className="p-5 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-32">Status</th>
                <th className="p-5 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-48">Created</th>
                <th className="p-5 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-48">Updated</th>
                <th className="p-5 text-label-sm font-mono text-muted uppercase tracking-[0.2em] w-40">Job ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6">
                    <EmptyState title="No jobs found for this run" />
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="bg-panel-row">
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
                        <span className="text-sm font-black text-accent tracking-tight leading-none">
                          {getResearchJobLabel(job)}
                        </span>
                      </div>
                    </td>
                    <td className="p-5">
                      <StatusChip
                        variant={
                          job.status === "COMPLETED"
                            ? "success"
                            : job.status === "FAILED"
                              ? "danger"
                              : "warning"
                        }
                        className="!py-0.5 !text-label-xs tracking-tighter"
                      >
                        {job.status}
                      </StatusChip>
                    </td>
                    <td className="p-5 font-mono text-label text-muted uppercase">{formatDate(job.createdAt)}</td>
                    <td className="p-5 font-mono text-label text-muted uppercase">{formatDate(job.updatedAt)}</td>
                    <td className="p-5 text-label font-mono text-accent-2/40">
                      {job.id}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </div>
  );
}
