"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";

// Types
type JobStatus = "NOT_STARTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
type JobType =
  | "CUSTOMER_RESEARCH"
  | "CUSTOMER_ANALYSIS"
  | "AD_PERFORMANCE"
  | "AD_QUALITY_GATE"
  | "PATTERN_ANALYSIS"
  | "PRODUCT_DATA_COLLECTION"
  | "PRODUCT_ANALYSIS";

interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  error?: any;
  payload?: any;
  createdAt: string;
  updatedAt: string;
  runId?: string | null;
}

interface JobGroup {
  runId: string | null;
  runLabel: string;
  color: string;
  jobs: Job[];
  runNumber?: number;
}

export default function JobListPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const jobType = params?.jobType as string;

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
    if (projectId && jobType) {
      loadJobs();
    }
  }, [loadJobs, projectId, jobType]);

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

  // Generate colors for each run
  const colors = [
    "bg-success/10 border-success/30",
    "bg-accent/10 border-accent-2/30",
    "bg-accent/10 border-accent/30",
    "bg-accent/10 border-accent/30",
    "bg-accent/10 border-accent/30",
    "bg-accent-2/10 border-accent-2/30",
  ];

  const groupedJobs: JobGroup[] = sortedRuns.map((run, index) => ({
    runId: run.runId === "unknown" ? null : run.runId,
    runLabel: `Run #${run.runNumber} (${formatDate(run.createdAt).split(",")[0]})`,
    color: colors[index % colors.length],
    jobs: run.jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    runNumber: run.runNumber,
  }));

  const StatusBadge = ({ status }: { status: JobStatus }) => {
    const classes = {
      NOT_STARTED: "status-chip info opacity-40",
      PENDING: "status-chip info opacity-60",
      RUNNING: "status-chip info",
      COMPLETED: "status-chip success",
      FAILED: "status-chip danger",
    };

    return (
      <span className={classes[status]}>
        {status.replace("_", " ")}
      </span>
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
      <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href={`/projects/${projectId}/research-hub`}
            className="text-[11px] font-mono text-muted hover:text-white uppercase tracking-wider transition-colors"
          >
            ← Back to Research Hub
          </Link>
        </div>
        <div className="rounded-card border border-accent/30 bg-accent/10 p-6 backdrop-blur-panel">
          <h2 className="text-sm font-bold text-accent mb-2 uppercase tracking-wide">Error Loading Jobs</h2>
          <p className="text-xs text-accent font-mono">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link
          href={`/projects/${projectId}/research-hub`}
          className="text-[11px] font-mono text-muted hover:text-white mb-6 inline-block uppercase tracking-wider transition-colors"
        >
          ← Back to Research Hub
        </Link>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">{getJobTypeLabel(jobType)} Logs</h1>
            <p className="text-[11px] font-mono text-muted uppercase tracking-widest opacity-60">
              {jobs.length} {jobs.length === 1 ? 'ENTRY' : 'ENTRIES'} RECORDED
            </p>
          </div>
        </div>
      </div>

      {/* Job Groups */}
      {groupedJobs.length === 0 ? (
        <div className="rounded-card border border-line bg-panel p-16 text-center shadow-panel backdrop-blur-panel">
          <p className="text-sm text-muted italic">No job logs found for this type.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedJobs.map((group) => (
            <div key={group.runId || 'no-run'} className="space-y-4">
              {/* Group Header */}
              <div className={`rounded-card border ${group.color} px-5 py-3 shadow-panel backdrop-blur-panel flex items-center justify-between`}>
                <h2 className="text-sm font-bold text-white uppercase tracking-tight">{group.runLabel}</h2>
                <p className="text-[10px] font-mono text-muted uppercase opacity-70">{group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'}</p>
              </div>

              {/* Jobs Table */}
              <div className="rounded-card border border-line bg-panel overflow-hidden shadow-panel backdrop-blur-panel">
                <table className="w-full">
                  <thead className="bg-bg-elevated/50 border-b border-line">
                    <tr>
                      <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                        Created
                      </th>
                      <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                        Status
                      </th>
                      <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                        Duration
                      </th>
                      <th className="px-5 py-3 text-right text-[10px] font-mono text-muted uppercase tracking-widest">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {group.jobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-bg-elevated/40 transition-colors group"
                      >
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
                              href={`/projects/${projectId}/research/data/${job.id}${
                                job.runId ? `?runId=${job.runId}` : ""
                              }`}
                              className="text-accent-2 hover:text-white text-[11px] font-mono uppercase tracking-wider underline underline-offset-4 decoration-accent-2/30 hover:decoration-white transition-all"
                            >
                              View Data →
                            </Link>
                          ) : (
                            <span className="text-muted opacity-30">—</span>
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
  );
}
