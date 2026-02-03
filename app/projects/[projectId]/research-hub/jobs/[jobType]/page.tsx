"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";

// Types
type JobStatus = "NOT_STARTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
type JobType =
  | "CUSTOMER_RESEARCH"
  | "CUSTOMER_ANALYSIS"
  | "AD_PERFORMANCE"
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

  useEffect(() => {
    if (projectId && jobType) {
      loadJobs();
    }
  }, [projectId, jobType]);

  const loadJobs = async () => {
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
  };

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
    "bg-emerald-500/10 border-emerald-500/30",
    "bg-sky-500/10 border-sky-500/30",
    "bg-violet-500/10 border-violet-500/30",
    "bg-amber-500/10 border-amber-500/30",
    "bg-rose-500/10 border-rose-500/30",
    "bg-cyan-500/10 border-cyan-500/30",
  ];

  const groupedJobs: JobGroup[] = sortedRuns.map((run, index) => ({
    runId: run.runId === "unknown" ? null : run.runId,
    runLabel: `Run #${run.runNumber} (${formatDate(run.createdAt).split(",")[0]})`,
    color: colors[index % colors.length],
    jobs: run.jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    runNumber: run.runNumber,
  }));

  const StatusBadge = ({ status }: { status: JobStatus }) => {
    const colors = {
      NOT_STARTED: "bg-slate-500/20 text-slate-400",
      PENDING: "bg-yellow-500/20 text-yellow-400",
      RUNNING: "bg-sky-500/20 text-sky-400",
      COMPLETED: "bg-emerald-500/20 text-emerald-400",
      FAILED: "bg-red-500/20 text-red-400",
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
        {status.replace("_", " ")}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="px-6 py-6 flex items-center justify-center min-h-screen">
        <p className="text-sm text-slate-400">Loading jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/projects/${projectId}/research-hub`}
            className="text-sm text-slate-400 hover:text-slate-300"
          >
            ← Back to Research Hub
          </Link>
        </div>
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6">
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Jobs</h2>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/projects/${projectId}/research-hub`}
          className="text-sm text-slate-400 hover:text-slate-300 mb-4 inline-block"
        >
          ← Back to Research Hub
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{getJobTypeLabel(jobType)} Jobs</h1>
            <p className="text-slate-400">
              {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} found
            </p>
          </div>
        </div>
      </div>

      {/* Job Groups */}
      {groupedJobs.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-12 text-center">
          <p className="text-slate-400">No jobs found for this type</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedJobs.map((group) => (
            <div key={group.runId || 'no-run'} className="space-y-3">
              {/* Group Header */}
              <div className={`rounded-lg border ${group.color} px-4 py-2`}>
                <h2 className="text-sm font-semibold text-white">{group.runLabel}</h2>
                <p className="text-xs text-slate-400">{group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'}</p>
              </div>

              {/* Jobs Table */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Duration
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {group.jobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-slate-300">
                          {formatDate(job.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">
                          {formatDuration(job.createdAt, job.updatedAt)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {job.status === "COMPLETED" ? (
                            <Link
                              href={`/projects/${projectId}/research/data/${job.id}${
                                job.runId ? `?runId=${job.runId}` : ""
                              }`}
                              className="text-sky-400 hover:text-sky-300 text-sm underline"
                            >
                              View Data →
                            </Link>
                          ) : (
                            <span className="text-slate-500">—</span>
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
