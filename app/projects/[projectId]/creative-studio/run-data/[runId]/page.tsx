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

  return (
    <main className="min-h-screen bg-bg text-white p-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Creative Production Run</h1>
            <p className="text-sm text-muted/80">
              Run ID: <span className="text-white/90">{runId || "N/A"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadJobs()}
              disabled={loading || deleting}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-white/90 hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
            <Link
              href={`/projects/${projectId}/creative-studio`}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-white/90 hover:bg-bg-elevated"
            >
              Back to Creative Studio
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              disabled={loading || deleting || jobs.length === 0}
              className="rounded-lg border border-line bg-bg-elevated px-3 py-2 text-sm text-white/90 hover:bg-panel-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {allSelected ? "Clear Selection" : "Select All"}
            </button>
            <button
              type="button"
              onClick={() => void deleteJobs("selected")}
              disabled={loading || deleting || selectedIds.length === 0}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete Selected ({selectedIds.length})
            </button>
            <button
              type="button"
              onClick={() => void deleteJobs("all")}
              disabled={loading || deleting || jobs.length === 0}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete All Creative Jobs
            </button>
            <span className="ml-auto text-xs text-muted/80">
              {jobs.length} job{jobs.length === 1 ? "" : "s"}
            </span>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-accent">{error}</p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-panel/90">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">Select</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Job</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Created</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Updated</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Job ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted/80">
                    Loading creative jobs...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted/60">
                    No creative jobs found for this run.
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
                    <td className="px-3 py-2 text-white/90">
                      <span>
                        {typeof job?.payload?.jobLabel === "string" && String(job.payload.jobLabel).trim()
                          ? String(job.payload.jobLabel).trim()
                          : CREATIVE_JOB_LABELS[job.type] ?? job.type}
                      </span>
                      {getSceneLabel(job) ? (
                        <span className="ml-2 rounded bg-panel-strong px-1.5 py-0.5 text-xs text-muted">
                          {getSceneLabel(job)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{job.status}</td>
                    <td className="px-3 py-2 text-muted/80">{formatDate(job.createdAt)}</td>
                    <td className="px-3 py-2 text-muted/80">{formatDate(job.updatedAt)}</td>
                    <td className="px-3 py-2 text-xs text-muted/60">{job.id}</td>
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
