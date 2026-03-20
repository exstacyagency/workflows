"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { EmptyState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

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
  const searchParams = useSearchParams();
  const projectId = params?.projectId as string;
  const jobType: JobType = "CUSTOMER_ANALYSIS";
  const runId = String(searchParams?.get("runId") ?? "").trim();
  const researchHubBackHref = `/projects/${projectId}/research-hub${runId ? `?runId=${runId}` : ""}`;

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
    const variants = {
      NOT_STARTED: "info",
      PENDING: "info",
      RUNNING: "running",
      COMPLETED: "success",
      FAILED: "danger",
    } as const;

    return (
      <StatusChip
        variant={variants[status]}
        className={status === "NOT_STARTED" ? "opacity-40" : status === "PENDING" ? "opacity-60" : ""}
      >
        {status.replace("_", " ")}
      </StatusChip>
    );
  };

  if (loading) {
    return (
      <div className="px-6 py-6 flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-mono text-muted uppercase tracking-widest">Initialising Logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg px-8 py-8 text-white space-y-6">
        <PageHeader backHref={researchHubBackHref} backLabel="Back to Research Hub" title="Customer Analysis History" />
        <EmptyState
          title="Analysis Load Failed"
          description={error}
          variant="error"
          action={<button onClick={loadJobs} className="btn btn-secondary mt-4">Retry</button>}
        />
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        backHref={researchHubBackHref}
        backLabel="Back to Research Hub"
        title="Customer Analysis History"
        description={`${jobs.length} ${jobs.length === 1 ? "ENTRY" : "ENTRIES"} RECORDED`}
      />

        {groupedJobs.length === 0 ? (
          <EmptyState title="No Analysis Runs Found" description="No analysis runs found for this project." />
        ) : (
          <div className="space-y-6">
            {groupedJobs.map((group) => (
              <div key={group.runId || "no-run"} className="space-y-6">
                <div className="flex items-center justify-between rounded-pill border border-line bg-bg-elevated px-5 py-3 shadow-panel backdrop-blur-panel">
                  <p className="eyebrow !mb-0">{group.runLabel}</p>
                  <p className="text-label font-mono uppercase text-muted opacity-70">
                    {group.jobs.length} {group.jobs.length === 1 ? "job" : "jobs"}
                  </p>
                </div>

                <SectionCard padding="none" className="overflow-hidden">
                  <table className="w-full">
                    <thead className="border-b border-line bg-panel">
                      <tr>
                        <th className="w-48 px-5 py-4 text-body-xs font-mono uppercase tracking-[0.12em] text-muted">Created</th>
                        <th className="w-32 px-5 py-4 text-body-xs font-mono uppercase tracking-[0.12em] text-muted">Status</th>
                        <th className="w-32 px-5 py-4 text-body-xs font-mono uppercase tracking-[0.12em] text-muted">Duration</th>
                        <th className="w-32 px-5 py-4 text-right text-body-xs font-mono uppercase tracking-[0.12em] text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {group.jobs.map((job) => (
                        <tr key={job.id} className="bg-panel-row transition-colors">
                          <td className="px-5 py-4 text-xs text-text font-mono">
                            {formatDate(job.createdAt)}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={job.status} />
                          </td>
                          <td className="px-5 py-4 text-xs text-muted font-mono">
                            {formatDuration(job.createdAt, job.updatedAt)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {job.status === "COMPLETED" ? (
                              <Link
                                href={`/projects/${projectId}/research-hub/analysis/data/${job.id}`}
                                className="btn btn-secondary !min-h-[32px] px-4 text-label"
                              >
                                View Data
                              </Link>
                            ) : (
                              <span className="text-label-sm font-mono text-muted/20 uppercase tracking-widest">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
