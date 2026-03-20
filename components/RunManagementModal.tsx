"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, SectionCard, StatusChip } from "@/components/ui";

type RunItem = {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  jobCount: number;
  latestJobType: string | null;
  latestJobSubtype: string | null;
  latestJobStatus: string | null;
  runNumber: number;
};

type RunChangeEvent = {
  type: "renamed" | "deleted";
  runId: string;
};

type RunManagementModalProps = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onRunsChanged?: (event: RunChangeEvent) => void | Promise<void>;
};

function formatRunDate(dateString: string): string {
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getJobTypeLabel(jobType: string | null, jobSubtype?: string | null): string {
  if (!jobType) return "No jobs yet";
  if (jobType === "AD_PERFORMANCE") {
    const subtype = String(jobSubtype ?? "").trim();
    if (subtype === "ad_ocr_collection") return "Extract OCR";
    if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
      return "Extract Transcripts";
    }
    return "Ad Collection";
  }
  const labels: Record<string, string> = {
    CUSTOMER_RESEARCH: "Customer Research",
    CUSTOMER_ANALYSIS: "Customer Analysis",
    AD_QUALITY_GATE: "Quality Assessment",
    PATTERN_ANALYSIS: "Pattern Analysis",
    PRODUCT_DATA_COLLECTION: "Product Collection",
    PRODUCT_ANALYSIS: "Product Analysis",
    SCRIPT_GENERATION: "Generate Script",
    STORYBOARD_GENERATION: "Create Storyboard",
    VIDEO_PROMPT_GENERATION: "Generate Video Prompts",
    VIDEO_IMAGE_GENERATION: "Generate Images",
    VIDEO_GENERATION: "Generate Video",
    VIDEO_REVIEW: "Review Video",
    VIDEO_UPSCALER: "Upscale & Export",
  };
  return labels[jobType] ?? jobType;
}

export default function RunManagementModal({
  projectId,
  open,
  onClose,
  onRunsChanged,
}: RunManagementModalProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingRunId, setSavingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load runs");
      }

      const nextRuns: RunItem[] = Array.isArray(data.runs) ? data.runs : [];
      setRuns(nextRuns);

      const nextDrafts: Record<string, string> = {};
      for (const run of nextRuns) {
        nextDrafts[run.id] = run.name ?? "";
      }
      setDraftNames(nextDrafts);
    } catch (err: any) {
      setRuns([]);
      setError(err?.message || "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRuns();
  }, [loadRuns, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runs],
  );

  async function handleRename(runId: string) {
    const draft = String(draftNames[runId] ?? "").trim();
    if (!draft) {
      setError("Run name cannot be empty.");
      return;
    }

    setSavingRunId(runId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to rename run");
      }

      setRuns((prev) =>
        prev.map((run) => (run.id === runId ? { ...run, name: draft } : run)),
      );
      if (onRunsChanged) {
        await onRunsChanged({ type: "renamed", runId });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to rename run");
    } finally {
      setSavingRunId(null);
    }
  }

  async function handleDelete(runId: string) {
    setDeletingRunId(runId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs/${runId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete run");
      }

      setRuns((prev) => prev.filter((run) => run.id !== runId));
      setDraftNames((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      setConfirmDeleteRunId(null);
      if (onRunsChanged) {
        await onRunsChanged({ type: "deleted", runId });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to delete run");
    } finally {
      setDeletingRunId(null);
    }
  }

  if (!open || !isMounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6 backdrop-blur-sm bg-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-card border border-line bg-bg text-white shadow-panel flex flex-col backdrop-blur-panel"
      >
        <div className="flex items-start justify-between gap-4 p-8 pb-4 bg-transparent">
          <div>
            <p className="eyebrow">Run Manager</p>
            <p className="text-xs font-mono text-muted uppercase tracking-wider mt-2 opacity-70">
              Rename or delete campaign runs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary !min-h-[32px] px-4 text-body-sm font-bold uppercase tracking-wider"
          >
            Close
          </button>
        </div>

        <div className="px-8 pb-8 overflow-hidden flex flex-col">
          {error && (
            <div className="mb-4">
              <EmptyState title={error} variant="error" />
            </div>
          )}

          {loading ? (
            <LoadingState title="Loading campaign runs" variant="section" minHeightClassName="py-12" />
          ) : sortedRuns.length === 0 ? (
            <EmptyState
              title="No Campaign Runs"
              description="No campaign runs found for this project."
            />
          ) : (
            <SectionCard padding="none" className="overflow-hidden">
              <div className="overflow-y-auto p-4 pr-2 space-y-3 custom-scrollbar">
              {sortedRuns.map((run) => {
                const draftName = String(draftNames[run.id] ?? "");
                const normalizedDraft = draftName.trim();
                const normalizedCurrent = String(run.name ?? "").trim();
                const renameDisabled =
                  savingRunId === run.id ||
                  !normalizedDraft ||
                  normalizedDraft === normalizedCurrent;

                return (
                  <SectionCard
                    key={run.id}
                    padding="sm"
                    className="transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="space-y-1">
                        <p className="text-body-xs font-mono text-accent uppercase tracking-[0.14em]">
                          Run #{run.runNumber}
                        </p>
                        <p className="text-base font-bold text-white tracking-tight">
                          {getJobTypeLabel(run.latestJobType, run.latestJobSubtype)}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label font-mono text-muted uppercase tracking-wider opacity-60">
                          <span className="text-white">{run.name?.trim() || "UNNAMED"}</span>
                          <span className="opacity-30">•</span>
                          <span className="text-accent-2">{run.id.slice(0, 8)}</span>
                          <span className="opacity-30">•</span>
                          <span>{run.jobCount} {run.jobCount === 1 ? "JOB" : "JOBS"}</span>
                          <span className="opacity-30">•</span>
                          <span>{formatRunDate(run.createdAt)}</span>
                        </div>
                      </div>
                      <StatusChip variant="info" className="opacity-80">
                        {run.latestJobStatus ? run.latestJobStatus.replaceAll("_", " ") : "Not Started"}
                      </StatusChip>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) =>
                          setDraftNames((prev) => ({ ...prev, [run.id]: e.target.value }))
                        }
                        placeholder="Assign Name..."
                        maxLength={120}
                        className="flex-1 min-w-[200px] rounded-pill border border-line bg-bg-elevated px-4 py-2 text-xs text-white placeholder:text-muted/20 outline-none focus:border-accent/40 transition-colors"
                      />
                      <button
                        type="button"
                        disabled={renameDisabled}
                        onClick={() => void handleRename(run.id)}
                        className={`btn px-4 py-2 text-label font-bold uppercase tracking-widest transition-all ${
                          renameDisabled 
                            ? "bg-transparent text-muted/20 cursor-not-allowed" 
                            : "btn-secondary text-accent-2 border-accent-2/30 hover:border-accent-2/40"
                        }`}
                      >
                        {savingRunId === run.id ? "Saving..." : "Rename"}
                      </button>

                      {confirmDeleteRunId === run.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingRunId === run.id}
                            onClick={() => void handleDelete(run.id)}
                            className="btn btn-secondary text-danger border-danger/30 hover:border-danger/40 px-4 py-2 text-label font-bold uppercase tracking-widest"
                          >
                            {deletingRunId === run.id ? "Wiping..." : "Confirm Wipe"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingRunId === run.id}
                            onClick={() => setConfirmDeleteRunId(null)}
                            className="text-label font-bold text-muted hover:text-white uppercase tracking-widest transition-colors px-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRunId(run.id)}
                          className="btn btn-secondary text-danger border-danger/20 hover:border-danger/30 px-4 py-2 text-label font-bold uppercase tracking-widest"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {confirmDeleteRunId === run.id && (
                      <p className="mt-3 text-label font-mono text-accent uppercase tracking-tight italic">
                        Caution: This action will purge all associated dataset entries.
                      </p>
                    )}
                  </SectionCard>
                );
              })}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
