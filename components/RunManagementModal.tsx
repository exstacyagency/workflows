"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";

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
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0.7)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "600px",
          maxHeight: "85vh",
          overflow: "hidden",
          borderRadius: "12px",
          border: "1px solid #334155",
          backgroundColor: "#0f172a",
          color: "#e2e8f0",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            padding: "20px",
            borderBottom: "1px solid #334155",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Manage Runs</h3>
            <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#94a3b8" }}>
              Rename runs or delete a run and all jobs in that run.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #475569",
              backgroundColor: "#1e293b",
              color: "#e2e8f0",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>
          {error && (
            <div
              style={{
                marginBottom: "12px",
                border: "1px solid rgba(239, 68, 68, 0.45)",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                color: "#fecaca",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>Loading runs...</p>
          ) : sortedRuns.length === 0 ? (
            <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>
              No runs found for this project.
            </p>
          ) : (
            <div
              style={{
                maxHeight: "55vh",
                overflowY: "auto",
                paddingRight: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {sortedRuns.map((run) => {
                const draftName = String(draftNames[run.id] ?? "");
                const normalizedDraft = draftName.trim();
                const normalizedCurrent = String(run.name ?? "").trim();
                const renameDisabled =
                  savingRunId === run.id ||
                  !normalizedDraft ||
                  normalizedDraft === normalizedCurrent;

                return (
                  <div
                    key={run.id}
                    style={{
                      border: "1px solid #334155",
                      borderRadius: "10px",
                      padding: "12px",
                      backgroundColor: "rgba(2, 6, 23, 0.55)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "10px",
                      }}
                    >
                      <div>
                        <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#f8fafc" }}>
                          {getJobTypeLabel(run.latestJobType, run.latestJobSubtype)}
                        </p>
                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#94a3b8" }}>
                          <span style={{ fontWeight: 600, color: "#cbd5e1" }}>Run #{run.runNumber}</span>
                          <span style={{ margin: "0 8px" }}>•</span>
                          <span>{run.name?.trim() || "Unnamed run"}</span>
                          <span style={{ margin: "0 8px" }}>•</span>
                          <span style={{ fontFamily: "monospace" }}>{run.id}</span>
                          <span style={{ margin: "0 8px" }}>•</span>
                          <span>
                            {run.jobCount} job{run.jobCount === 1 ? "" : "s"}
                          </span>
                          <span style={{ margin: "0 8px" }}>•</span>
                          <span>{formatRunDate(run.createdAt)}</span>
                        </div>
                      </div>
                      <span
                        style={{
                          borderRadius: "999px",
                          backgroundColor: "#1e293b",
                          color: "#cbd5e1",
                          padding: "3px 10px",
                          fontSize: "11px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {run.latestJobStatus ?? "NOT_STARTED"}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) =>
                          setDraftNames((prev) => ({ ...prev, [run.id]: e.target.value }))
                        }
                        placeholder="Run name"
                        maxLength={120}
                        style={{
                          flex: "1 1 260px",
                          minWidth: "220px",
                          border: "1px solid #475569",
                          backgroundColor: "#0f172a",
                          color: "#e2e8f0",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          fontSize: "14px",
                        }}
                      />
                      <button
                        type="button"
                        disabled={renameDisabled}
                        onClick={() => void handleRename(run.id)}
                        style={{
                          border: "1px solid #0284c7",
                          backgroundColor: "rgba(2, 132, 199, 0.2)",
                          color: "#bae6fd",
                          borderRadius: "8px",
                          padding: "8px 12px",
                          fontSize: "14px",
                          cursor: renameDisabled ? "not-allowed" : "pointer",
                          opacity: renameDisabled ? 0.55 : 1,
                        }}
                      >
                        {savingRunId === run.id ? "Saving..." : "Rename"}
                      </button>

                      {confirmDeleteRunId === run.id ? (
                        <>
                          <button
                            type="button"
                            disabled={deletingRunId === run.id}
                            onClick={() => void handleDelete(run.id)}
                            style={{
                              border: "1px solid #dc2626",
                              backgroundColor: "rgba(220, 38, 38, 0.2)",
                              color: "#fecaca",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "14px",
                              cursor: deletingRunId === run.id ? "not-allowed" : "pointer",
                              opacity: deletingRunId === run.id ? 0.55 : 1,
                            }}
                          >
                            {deletingRunId === run.id ? "Deleting..." : "Confirm Delete"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingRunId === run.id}
                            onClick={() => setConfirmDeleteRunId(null)}
                            style={{
                              border: "1px solid #475569",
                              backgroundColor: "#1e293b",
                              color: "#e2e8f0",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "14px",
                              cursor: deletingRunId === run.id ? "not-allowed" : "pointer",
                              opacity: deletingRunId === run.id ? 0.55 : 1,
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRunId(run.id)}
                          style={{
                            border: "1px solid #b91c1c",
                            backgroundColor: "rgba(185, 28, 28, 0.15)",
                            color: "#fca5a5",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontSize: "14px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {confirmDeleteRunId === run.id && (
                      <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#fca5a5" }}>
                        Deleting this run will permanently remove all jobs and derived data in this run.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
