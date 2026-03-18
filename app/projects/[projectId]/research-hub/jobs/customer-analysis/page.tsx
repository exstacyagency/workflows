"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";

type JobStatus = "NOT_STARTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
type JobType = "CUSTOMER_ANALYSIS";

interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  error?: any;
  payload?: any;
  resultSummary?: any;
  createdAt: string;
  updatedAt: string;
  runId?: string | null;
}

interface JobGroup {
  runId: string | null;
  runLabel: string;
  jobs: Job[];
  runNumber?: number;
}

export default function CustomerAnalysisJobsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const jobType: JobType = "CUSTOMER_ANALYSIS";

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs?type=${jobType}`);
      const data = await response.json();

      if (data.success) {
        setJobs(data.jobs);
      } else {
        setError(data.error || "Failed to load jobs");
      }
    } catch (err: any) {
      console.error("Failed to load jobs:", err);
      setError(err.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [projectId, jobType]);

  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [loadJobs, projectId]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (createdAt: string, updatedAt: string) => {
    const start = new Date(createdAt).getTime();
    const end = new Date(updatedAt).getTime();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  const formatSummary = (summary: any) => {
    if (!summary) return "—";
    if (typeof summary === "string") return summary;
    if (typeof summary.summary === "string") return summary.summary;
    return JSON.stringify(summary);
  };

  const runGroups = jobs.reduce<Record<string, { runId: string; createdAt: string; jobs: Job[] }>>(
    (acc, job) => {
      const runId = job.runId || "unknown";
      if (!acc[runId]) {
        acc[runId] = {
          runId,
          createdAt: job.createdAt,
          jobs: [],
        };
      }
      acc[runId].jobs.push(job);
      if (new Date(job.createdAt).getTime() < new Date(acc[runId].createdAt).getTime()) {
        acc[runId].createdAt = job.createdAt;
      }
      return acc;
    },
    {}
  );

  const sortedRuns = Object.values(runGroups)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((run, index) => ({
      ...run,
      runNumber: index + 1,
    }))
    .reverse();

  const groupedJobs: JobGroup[] = sortedRuns.map((run) => ({
    runId: run.runId === "unknown" ? null : run.runId,
    runLabel: `Run #${run.runNumber} (${formatDate(run.createdAt).split(",")[0]})`,
    jobs: run.jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    runNumber: run.runNumber,
  }));

  const StatusBadge = ({ status }: { status: JobStatus }) => {
    return (
      <span className={`status-chip ${
        status === 'COMPLETED' ? 'success' :
        status === 'FAILED' ? 'danger' :
        status === 'RUNNING' ? 'info' :
        'subtle'
      }`}>
        {status.replace("_", " ")}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-8 py-8 text-white">
        <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted">Fetching analysis history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg px-8 py-8 text-white space-y-6">
        <Link
          href={`/projects/${projectId}/research-hub`}
          className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
        >
          ← Back to Research Hub
        </Link>
        <div className="rounded-card border border-danger/20 bg-danger/5 p-6 space-y-2">
          <p className="text-[10px] font-mono text-danger uppercase tracking-widest font-bold">Analysis load failed</p>
          <p className="text-sm text-muted leading-relaxed">{error}</p>
          <button onClick={loadJobs} className="btn btn-secondary mt-4">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="border-b border-line bg-panel backdrop-blur-md px-8 py-6 sticky top-0 z-30">
        <div className="flex items-center justify-between gap-6">
          <div className="space-y-4">
            <Link
              href={`/projects/${projectId}/research-hub`}
              className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
            >
              ← Back to Research Hub
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold tracking-tight text-white">Analysis History</h1>
              <div className="status-chip success uppercase tracking-widest text-[9px]">
                {jobType}
              </div>
            </div>
            <p className="text-xs text-muted font-mono uppercase tracking-widest opacity-60">
              Analysis Type: <span className="text-accent">Audience Insights</span> 
              <span className="mx-3 opacity-20">|</span> 
              Runs: <span className="text-white">{jobs.length} Entries</span>
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-10 space-y-12 max-w-[1400px]">
        {groupedJobs.length === 0 ? (
          <div className="rounded-card border border-line bg-panel p-20 text-center shadow-panel backdrop-blur-panel">
            <p className="text-[10px] font-mono text-muted uppercase tracking-widest opacity-40 italic">No analysis runs found for this project.</p>
          </div>
        ) : (
          <div className="space-y-12">
            {groupedJobs.map((group) => (
              <div key={group.runId || "no-run"} className="space-y-6">
                <div className="flex items-center justify-between rounded-pill border border-line bg-bg-elevated px-5 py-3 shadow-panel backdrop-blur-panel">
                  <h2 className="text-sm font-bold uppercase tracking-tight text-white">
                    {group.runLabel}
                  </h2>
                  <p className="text-[10px] font-mono uppercase text-muted opacity-70">
                    {group.jobs.length} {group.jobs.length === 1 ? "job" : "jobs"}
                  </p>
                </div>

                <div className="rounded-card border border-line bg-panel overflow-hidden shadow-panel backdrop-blur-panel">
                  <div className="border-b border-line bg-panel px-6 py-3">
                    <h3 className="text-[9px] font-mono text-accent uppercase tracking-[0.2em] font-bold">Run History</h3>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead className="border-b border-line bg-panel">
                      <tr>
                        <th className="w-48 px-5 py-4 text-[0.76rem] font-mono uppercase tracking-[0.12em] text-muted">Created</th>
                        <th className="w-32 px-5 py-4 text-[0.76rem] font-mono uppercase tracking-[0.12em] text-muted">Status</th>
                        <th className="w-32 px-5 py-4 text-[0.76rem] font-mono uppercase tracking-[0.12em] text-muted">Duration</th>
                        <th className="px-5 py-4 text-[0.76rem] font-mono uppercase tracking-[0.12em] text-muted">Summary</th>
                        <th className="w-32 px-5 py-4 text-right text-[0.76rem] font-mono uppercase tracking-[0.12em] text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {group.jobs.map((job) => (
                        <tr key={job.id} className="bg-panel-row transition-colors">
                          <td className="px-5 py-4 font-mono text-[11px] text-muted uppercase">
                            {formatDate(job.createdAt)}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={job.status} />
                          </td>
                          <td className="px-5 py-4 text-[11px] font-mono text-accent-2/60 uppercase">
                            {formatDuration(job.createdAt, job.updatedAt)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="rounded-inner border border-line/40 bg-panel-row px-4 py-3 text-[13px] font-medium leading-relaxed text-white/80">
                              {formatSummary(job.resultSummary)}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-right">
                            {job.status === "COMPLETED" ? (
                              <Link
                                href={`/projects/${projectId}/research-hub/analysis/data/${job.id}`}
                                className="text-[11px] font-mono uppercase tracking-wider text-accent-2 underline decoration-accent-2/30 underline-offset-4 transition-all hover:text-white hover:decoration-white"
                              >
                                View Data →
                              </Link>
                            ) : (
                              <span className="text-[9px] font-mono text-muted/20 uppercase tracking-widest">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
