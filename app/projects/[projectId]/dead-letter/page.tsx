"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DeadJob = {
  id: string;
  type: string;
  status: string;
  error: string | null;
  payload: any;
  resultSummary: string | null;
  attempts: number;
  nextRunAt: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function getRecommendation(errorText: string | null | undefined) {
  const msg = (errorText ?? "").toLowerCase();

  if (msg.includes("missing dependencies")) {
    return "Run: Customer Avatar → Product Intelligence → Ad Analysis (then retry Script Generation).";
  }

  if (msg.includes("redis_url missing") || msg.includes("redis not configured")) {
    return "Set REDIS_URL in .env (or disable queue dependency for this step in dev).";
  }

  if (msg.includes("apify") && msg.includes("must be set in .env")) {
    return "Set APIFY_API_TOKEN (and required dataset/actor IDs) in .env.";
  }

  if (msg.includes("kie") && msg.includes("must be set in .env")) {
    return "Set KIE_API_KEY (and required URLs) in .env.";
  }

  return null;
}

export default function DeadLetterPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [jobs, setJobs] = useState<DeadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const endpoints = useMemo(() => {
    const base = `/api/projects/${encodeURIComponent(projectId)}/dead-letter`;
    return {
      list: base,
      retry: (jobId: string) => `${base}/${encodeURIComponent(jobId)}/retry`,
      clearAttempts: (jobId: string) => `${base}/${encodeURIComponent(jobId)}/clear-attempts`,
      dismiss: (jobId: string) => `${base}/${encodeURIComponent(jobId)}/dismiss`,
    };
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(endpoints.list, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJobs([]);
        setMsg(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      setJobs(Array.isArray(json?.jobs) ? (json.jobs as DeadJob[]) : []);
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [endpoints.list]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string) {
    setMsg(null);
    const res = await fetch(url, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error ?? `Request failed (${res.status})`);
    }
  }

  async function onRetry(jobId: string) {
    setBusyJobId(jobId);
    try {
      await post(endpoints.retry(jobId));
      setMsg("Job queued for retry.");
      await load();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusyJobId(null);
    }
  }

  async function onClearAttempts(jobId: string) {
    setBusyJobId(jobId);
    try {
      await post(endpoints.clearAttempts(jobId));
      setMsg("Attempts cleared.");
      await load();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusyJobId(null);
    }
  }

  async function onDismiss(jobId: string) {
    setBusyJobId(jobId);
    try {
      await post(endpoints.dismiss(jobId));
      setMsg("Dismissed.");
      await load();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusyJobId(null);
    }
  }

  function fmtNextRun(nextRunAt: number | null) {
    if (!nextRunAt) return "—";
    try {
      return new Date(nextRunAt).toLocaleString();
    } catch {
      return String(nextRunAt);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied");
      setTimeout(() => setMsg(null), 1200);
    } catch {
      setMsg("Copy failed");
      setTimeout(() => setMsg(null), 1200);
    }
  }

  async function bulk(action: "dismiss_all" | "clear_attempts_all" | "retry_all_transient") {
    setMsg(null);
    const res = await fetch(`/api/projects/${projectId}/dead-letter/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error ?? "Bulk action failed");
      return;
    }
    setMsg(`OK (updated ${data.updated ?? 0})`);
    await load();
  }

  function act(jobId: string, action: "retry" | "clear-attempts" | "dismiss") {
    if (action === "retry") return void onRetry(jobId);
    if (action === "clear-attempts") return void onClearAttempts(jobId);
    return void onDismiss(jobId);
  }

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow !mb-2">Project</p>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Dead Letter</h1>
          <p className="text-sm text-muted mt-1 italic">
            Failed jobs that won’t be retried automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="btn btn-secondary !min-h-[36px] px-4 text-xs"
          >
            Back
          </Link>
          <button
            onClick={() => void bulk("retry_all_transient")}
            className="btn btn-secondary !min-h-[36px] px-4 text-xs"
          >
            Retry all
          </button>
          <button
            onClick={() => void bulk("clear_attempts_all")}
            className="btn btn-secondary !min-h-[36px] px-4 text-xs"
          >
            Clear all
          </button>
          <button
            onClick={() => void bulk("dismiss_all")}
            className="btn btn-secondary !min-h-[36px] px-4 text-xs"
          >
            Dismiss all
          </button>
          <button
            onClick={() => void load()}
            className="btn btn-primary !min-h-[36px] px-6 text-xs"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-card border border-line bg-panel px-4 py-3 text-sm text-muted font-mono italic">
          {msg}
        </div>
      ) : null}

      <div className="rounded-card border border-line bg-panel shadow-panel backdrop-blur-panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-sm font-bold text-white uppercase tracking-tight">Failed Jobs</h2>
          <p className="text-[10px] font-mono text-muted/40 uppercase tracking-widest">{loading ? "Loading…" : `${jobs.length} items recorded`}</p>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center space-y-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-mono text-muted uppercase tracking-widest">Polling Queue...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-5 py-12 text-center text-xs text-muted italic">No failed jobs in this sector.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/50 border-b border-line">
                <tr>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Type</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Attempts</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Next run</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Error</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Updated</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((j) => {
                  const rec = getRecommendation(j.lastError ?? j.error);

                  return [
                    <tr key={j.id} className="hover:bg-bg-elevated/40 transition-colors">
                      <td className="px-5 py-4 text-xs font-mono text-accent-2">{j.type}</td>
                      <td className="px-5 py-4 text-xs text-muted">{j.attempts}</td>
                      <td className="px-5 py-4 text-xs text-muted font-mono">{fmtNextRun(j.nextRunAt)}</td>
                      <td className="px-5 py-4">
                        <div className="max-w-[420px] truncate text-xs text-white/80" title={j.lastError ?? j.error ?? ""}>
                          {j.lastError ?? j.error ?? "—"}
                        </div>
                        {rec && (
                          <div className="mt-1 text-[10px] font-mono text-accent italic">
                            REC: {rec}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[10px] font-mono text-muted/40 uppercase tracking-tight">{new Date(j.updatedAt).toLocaleString()}</td>
                      <td className="px-5 py-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => act(j.id, "retry")}
                          disabled={busyJobId === j.id}
                          className="btn btn-secondary !min-h-[28px] px-3 text-[10px]"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => act(j.id, "clear-attempts")}
                          disabled={busyJobId === j.id}
                          className="btn btn-secondary !min-h-[28px] px-3 text-[10px]"
                        >
                          Reset
                        </button>
                        <button
                          onClick={() => act(j.id, "dismiss")}
                          disabled={busyJobId === j.id}
                          className="btn btn-secondary !min-h-[28px] px-3 text-[10px] hover:text-danger hover:border-danger/30"
                        >
                          Kill
                        </button>
                        <button
                          onClick={() => setExpandedId(expandedId === j.id ? null : j.id)}
                          className="btn btn-secondary !min-h-[28px] px-3 text-[10px]"
                        >
                          {expandedId === j.id ? "Close" : "Data"}
                        </button>
                      </td>
                    </tr>,
                    expandedId === j.id ? (
                      <tr key={`${j.id}:details`} className="bg-bg-elevated/20 border-t border-line">
                        <td colSpan={6} className="p-6 space-y-4">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="text-[11px] font-mono text-muted uppercase tracking-widest">
                              JobID: <span className="text-accent-2">{j.id}</span>
                            </div>
                            <button
                              onClick={() => void copy(j.id)}
                              className="btn btn-secondary !min-h-[24px] px-2 text-[10px] opacity-70 hover:opacity-100"
                            >
                              Copy ID
                            </button>
                            <button
                              onClick={() => void copy(JSON.stringify(j.payload ?? {}, null, 2))}
                              className="btn btn-secondary !min-h-[24px] px-2 text-[10px] opacity-70 hover:opacity-100"
                            >
                              Copy Payload
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="card-label !mb-0">Job Error</div>
                              <div className="font-mono text-[11px] whitespace-pre-wrap break-words bg-panel border border-line rounded-card p-4 text-danger/80">
                                {j.error ?? "—"}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="card-label !mb-0">Context Trace</div>
                              <div className="font-mono text-[11px] whitespace-pre-wrap break-words bg-panel border border-line rounded-card p-4 text-accent-2/60">
                                {j.lastError ?? "—"}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="card-label !mb-0">Payload Schema</div>
                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-panel border border-line rounded-card p-5 text-muted/60 overflow-x-auto">
{JSON.stringify(j.payload ?? {}, null, 2)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
