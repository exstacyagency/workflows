"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    return "Run: Customer Avatar → Product Intelligence → Pattern Analysis (then retry Script Generation).";
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

export default function DeadLetterPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
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
    <div className="px-6 py-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-slate-500">Project</p>
          <h1 className="text-2xl font-semibold text-slate-50">Dead Letter</h1>
          <p className="text-sm text-slate-400 mt-1">
            Failed jobs that won’t be retried automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Back
          </Link>
          <button
            onClick={() => void bulk("retry_all_transient")}
            className="px-3 py-2 rounded border border-white/10 hover:border-white/20 text-sm text-slate-200"
          >
            Retry all (transient)
          </button>
          <button
            onClick={() => void bulk("clear_attempts_all")}
            className="px-3 py-2 rounded border border-white/10 hover:border-white/20 text-sm text-slate-200"
          >
            Clear attempts (all)
          </button>
          <button
            onClick={() => void bulk("dismiss_all")}
            className="px-3 py-2 rounded border border-white/10 hover:border-white/20 text-sm text-slate-200"
          >
            Dismiss all
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center justify-center rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
          {msg}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-800 bg-slate-900/70">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-100">Failed Jobs</h2>
          <p className="text-xs text-slate-400">{loading ? "Loading…" : `${jobs.length} shown`}</p>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-slate-400">Loading failed jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-400">No failed jobs.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400">
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-left font-medium">Attempts</th>
                  <th className="p-3 text-left font-medium">Next run</th>
                  <th className="p-3 text-left font-medium">Error</th>
                  <th className="p-3 text-left font-medium">Updated</th>
                  <th className="p-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const rec = getRecommendation(j.lastError ?? j.error);

                  return [
                    <tr key={j.id} className="border-t border-white/10">
                      <td className="p-3 font-mono">{j.type}</td>
                      <td className="p-3">{j.attempts}</td>
                      <td className="p-3">{fmtNextRun(j.nextRunAt)}</td>
                      <td className="p-3">
                        <div className="max-w-[520px] truncate" title={j.lastError ?? j.error ?? ""}>
                          {j.lastError ?? j.error ?? "—"}
                        </div>
                        {rec && (
                          <div className="mt-1 text-xs text-white/60">
                            Recommended: {rec}
                          </div>
                        )}
                      </td>
                      <td className="p-3">{new Date(j.updatedAt).toLocaleString()}</td>
                      <td className="p-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => act(j.id, "retry")}
                          disabled={busyJobId === j.id}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        >
                          Retry now
                        </button>
                        <button
                          onClick={() => act(j.id, "clear-attempts")}
                          disabled={busyJobId === j.id}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        >
                          Clear attempts
                        </button>
                        <button
                          onClick={() => act(j.id, "dismiss")}
                          disabled={busyJobId === j.id}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => setExpandedId(expandedId === j.id ? null : j.id)}
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                        >
                          {expandedId === j.id ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>,
                    expandedId === j.id ? (
                      <tr key={`${j.id}:details`} className="border-t border-white/10 bg-white/[0.03]">
                        <td colSpan={6} className="p-4 space-y-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="text-xs text-white/70">
                              <span className="font-mono">jobId</span>:{" "}
                              <span className="font-mono">{j.id}</span>
                            </div>
                            <button
                              onClick={() => void copy(j.id)}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
                            >
                              Copy jobId
                            </button>
                            <button
                              onClick={() => void copy(JSON.stringify(j.payload ?? {}, null, 2))}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
                            >
                              Copy payload
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="text-sm">
                              <div className="text-xs text-white/60 mb-1">Error (job.error)</div>
                              <div className="font-mono text-xs whitespace-pre-wrap break-words bg-black/30 border border-white/10 rounded p-2">
                                {j.error ?? "—"}
                              </div>
                            </div>

                            <div className="text-sm">
                              <div className="text-xs text-white/60 mb-1">
                                Last Error (payload.lastError)
                              </div>
                              <div className="font-mono text-xs whitespace-pre-wrap break-words bg-black/30 border border-white/10 rounded p-2">
                                {j.lastError ?? "—"}
                              </div>
                            </div>
                          </div>

                          <div className="text-sm">
                            <div className="text-xs text-white/60 mb-1">Payload</div>
                            <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-black/30 border border-white/10 rounded p-3 overflow-x-auto">
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
