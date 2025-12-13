"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DeadJob = {
  id: string;
  type: string;
  status: string;
  error: string | null;
  resultSummary: string | null;
  attempts: number;
  nextRunAt: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatWhen(value: string | number | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export default function DeadLetterPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const [jobs, setJobs] = useState<DeadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

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
          <div className="divide-y divide-slate-800">
            {jobs.map((j) => (
              <div key={j.id} className="px-4 py-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">{j.type}</span>
                    <span className="text-[11px] text-slate-500 font-mono">{j.id}</span>
                    <span className="text-[11px] rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-red-200">
                      {j.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-200 break-words">
                    {j.error || j.lastError || "Unknown error"}
                  </div>
                  {j.resultSummary ? (
                    <div className="text-xs text-slate-400 break-words">{j.resultSummary}</div>
                  ) : null}
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Attempts: {j.attempts}</span>
                    <span>Next run: {formatWhen(j.nextRunAt)}</span>
                    <span>Updated: {formatWhen(j.updatedAt)}</span>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col gap-2 md:items-end">
                  <button
                    onClick={() => void onRetry(j.id)}
                    disabled={busyJobId === j.id}
                    className="rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => void onClearAttempts(j.id)}
                    disabled={busyJobId === j.id}
                    className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  >
                    Clear attempts
                  </button>
                  <button
                    onClick={() => void onDismiss(j.id)}
                    disabled={busyJobId === j.id}
                    className="rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

