"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { JobStatus, JobType } from "@prisma/client";

type CreativeJob = {
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

const CREATIVE_JOB_LABELS: Record<string, string> = {
  SCRIPT_GENERATION: "Generate Script",
  STORYBOARD_GENERATION: "Create Storyboard",
  IMAGE_PROMPT_GENERATION: "Generate Image Prompts",
  VIDEO_IMAGE_GENERATION: "Generate Images",
  VIDEO_PROMPT_GENERATION: "Generate Video Prompts",
  VIDEO_GENERATION: "Generate Video",
  VIDEO_REVIEW: "Review Video",
  VIDEO_UPSCALER: "Swap Audio",
};

function getSceneLabel(job: CreativeJob): string | null {
  if (job.type !== "VIDEO_IMAGE_GENERATION") return null;
  const payload = job.payload;
  if (!payload) return null;

  // Single scene regeneration — sceneNumber at top level
  const topLevel = payload.sceneNumber;
  if (typeof topLevel === "number") return `Scene ${topLevel}`;

  // Batch — extract unique scene numbers from prompts array
  const prompts = payload.prompts;
  if (Array.isArray(prompts) && prompts.length > 0) {
    const sceneNumbers = [
      ...new Set(
        prompts
          .map((p: any) => p?.sceneNumber)
          .filter((n): n is number => typeof n === "number"),
      ),
    ].sort((a, b) => a - b);

    if (sceneNumbers.length === 1) return `Scene ${sceneNumbers[0]}`;
    if (sceneNumbers.length > 1)
      return `Scenes ${sceneNumbers[0]}–${sceneNumbers[sceneNumbers.length - 1]}`;
  }

  return null;
}

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


export default function CreativeRunDataPage() {
  const params = useParams();
  const projectId = String(params?.projectId ?? "").trim();
  const runId = String(params?.runId ?? "").trim();

  const [jobs, setJobs] = useState<CreativeJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  const loadJobs = useCallback(async () => {
    if (!projectId || !runId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/creative-jobs`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load creative run jobs");
      }
      const rows = Array.isArray(data.jobs) ? (data.jobs as CreativeJob[]) : [];
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
      setError(err?.message || "Failed to load creative run jobs");
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
    setSelectedJobIds((prev) => {
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
        ? `Delete ${selectedIds.length} selected creative job(s)? This cannot be undone.`
        : `Delete ALL creative jobs in this run? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}/creative-jobs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          deletingSelected ? { jobIds: selectedIds } : { deleteAll: true },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete creative jobs");
      }
      setSelectedJobIds({});
      await loadJobs();
    } catch (err: any) {
      setError(err?.message || "Failed to delete creative jobs");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-white px-8 py-8">
        <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted animate-pulse">
            Loading run data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel px-8 py-6 backdrop-blur-md">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-4">
            <Link
              href={`/projects/${projectId}/creative-studio`}
              className="inline-block text-[11px] font-mono uppercase tracking-widest text-muted transition-colors hover:text-white"
            >
              ← Back to Creative Studio
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold tracking-tight text-white">Run Overview</h1>
              <div className="status-chip subtle text-[9px] uppercase tracking-widest">
                {runId.substring(0, 8)}
              </div>
            </div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted opacity-60">
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

      <div className="mx-auto max-w-[1200px] space-y-8 px-8 py-10">
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-panel p-6 backdrop-blur-panel">
          <button
            onClick={toggleAll}
            disabled={jobs.length === 0}
            className="rounded-pill border border-line bg-bg-elevated px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-muted transition-colors hover:text-white"
          >
            {allSelected ? "Clear Selection" : "Select All Jobs"}
          </button>

          <div className="mx-2 h-4 w-px bg-line/50"></div>

          <button
            onClick={() => void deleteJobs("selected")}
            disabled={selectedIds.length === 0 || deleting}
            className="rounded-pill border border-danger/20 bg-danger/5 px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-widest text-danger transition-all hover:bg-danger/10"
          >
            Delete Selected ({selectedIds.length})
          </button>

          <button
            onClick={() => void deleteJobs("all")}
            disabled={jobs.length === 0 || deleting}
            className="rounded-pill border border-danger/40 bg-danger/10 px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-widest text-danger transition-all hover:bg-danger/20"
          >
            Delete All Jobs
          </button>

          {error && (
            <div className="ml-4 rounded border border-danger/20 bg-danger/10 px-3 py-1.5 text-[10px] font-mono uppercase text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-panel shadow-panel">
          <div className="border-b border-line bg-bg-elevated px-6 py-3">
            <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-accent">
              Run Jobs
            </h2>
          </div>
          <table className="w-full border-collapse text-left">
            <thead className="border-b border-line bg-bg-elevated">
              <tr>
                <th className="w-10 p-5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 cursor-pointer rounded-sm border-line bg-panel transition-all checked:border-accent-2 checked:bg-accent-2"
                  />
                </th>
                <th className="p-5 text-[9px] font-mono uppercase tracking-[0.2em] text-accent">
                  Job Type
                </th>
                <th className="w-32 p-5 text-[9px] font-mono uppercase tracking-[0.2em] text-muted">
                  Status
                </th>
                <th className="w-48 p-5 text-[9px] font-mono uppercase tracking-[0.2em] text-muted">
                  Created
                </th>
                <th className="w-48 p-5 text-[9px] font-mono uppercase tracking-[0.2em] text-muted">
                  Updated
                </th>
                <th className="w-40 p-5 text-[9px] font-mono uppercase tracking-[0.2em] text-muted">
                  Job ID
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {jobs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-10 text-center text-[10px] font-mono uppercase tracking-widest text-muted opacity-40"
                  >
                    No jobs found for this run
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="group bg-panel-row transition-colors">
                    <td className="p-5">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedJobIds[job.id])}
                        onChange={() => toggleOne(job.id)}
                        className="h-3.5 w-3.5 cursor-pointer rounded-sm border-line bg-panel transition-all checked:border-accent-2 checked:bg-accent-2"
                        disabled={deleting}
                      />
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-black leading-none tracking-tight text-accent">
                            {typeof job?.payload?.jobLabel === "string" && String(job.payload.jobLabel).trim()
                              ? String(job.payload.jobLabel).trim()
                              : CREATIVE_JOB_LABELS[job.type] ?? job.type}
                          </span>
                          {getSceneLabel(job) ? (
                            <span className="text-[9px] font-mono uppercase tracking-widest text-muted opacity-50">
                              {getSceneLabel(job)}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-widest text-muted opacity-40">
                          {job.type}
                        </span>
                      </div>
                    </td>
                    <td className="p-5">
                      <span
                        className={`status-chip !py-0.5 !text-[8.5px] font-bold uppercase tracking-tighter ${
                          job.status === "COMPLETED"
                            ? "success"
                            : job.status === "FAILED"
                              ? "danger"
                              : "warning"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="p-5 font-mono text-[10px] uppercase text-muted">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="p-5 font-mono text-[10px] uppercase text-muted">
                      {formatDate(job.updatedAt)}
                    </td>
                    <td className="max-w-[100px] cursor-default truncate p-5 text-[10px] font-mono text-accent-2/40 transition-all hover:max-w-none">
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
