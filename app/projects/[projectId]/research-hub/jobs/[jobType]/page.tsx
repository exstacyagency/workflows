"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";
import { EmptyState, PageHeader, SectionCard, StatusChip } from "@/components/ui";

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
  jobs: Job[];
  runNumber?: number;
}

export default function JobListPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params?.projectId as string;
  const jobType = params?.jobType as string;
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
      <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        <PageHeader
          backHref={researchHubBackHref}
          backLabel="Back to Research Hub"
          title={`${getJobTypeLabel(jobType)} History`}
        />
        <EmptyState title="Error Loading Jobs" description={error} variant="error" />
      </div>
    );
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        backHref={researchHubBackHref}
        backLabel="Back to Research Hub"
        title={`${getJobTypeLabel(jobType)} History`}
        description={`${jobs.length} ${jobs.length === 1 ? "ENTRY" : "ENTRIES"} RECORDED`}
      />

      {/* Job Groups */}
      {groupedJobs.length === 0 ? (
        <EmptyState title="No History Found" description={`No ${getJobTypeLabel(jobType).toLowerCase()} history found for this project.`} />
      ) : (
        <div className="space-y-6">
          {groupedJobs.map((group) => (
            <div key={group.runId || 'no-run'} className="space-y-4">
              {/* Group Header */}
              <div className="flex items-center justify-between rounded-pill border border-line bg-bg-elevated px-5 py-3 shadow-panel backdrop-blur-panel">
                <p className="eyebrow !mb-0">{group.runLabel}</p>
                <p className="text-label font-mono text-muted uppercase opacity-70">{group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'}</p>
              </div>

              {/* Jobs Table */}
              <SectionCard padding="none" className="overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-line bg-panel">
                    <tr>
                      <th className="px-5 py-3 text-left text-body-xs font-mono uppercase tracking-[0.12em] text-muted">
                        Created
                      </th>
                      <th className="px-5 py-3 text-left text-body-xs font-mono uppercase tracking-[0.12em] text-muted">
                        Status
                      </th>
                      <th className="px-5 py-3 text-left text-body-xs font-mono uppercase tracking-[0.12em] text-muted">
                        Duration
                      </th>
                      <th className="px-5 py-3 text-right text-body-xs font-mono uppercase tracking-[0.12em] text-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {group.jobs.map((job) => (
                      <tr
                        key={job.id}
                        className="bg-panel-row transition-colors"
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
                              href={(() => {
                                const subtype = String(job.payload?.jobType || job.payload?.kind || "").trim();
                                if (job.type === "AD_PERFORMANCE") {
                                  if (subtype === "ad_ocr_collection" || subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
                                    return `/projects/${projectId}/research-hub/data?jobType=${
                                      subtype === "ad_ocr_collection" ? "ad-ocr" : "ad-transcripts"
                                    }${job.runId ? `&runId=${job.runId}` : ""}`;
                                  }
                                  return job.runId
                                    ? `/projects/${projectId}/research-hub/ad-assets/${job.runId}`
                                    : `/projects/${projectId}/research-hub`;
                                }
                                if (job.type === "AD_QUALITY_GATE") {
                                  return `/projects/${projectId}/research-hub/data?jobType=ad-quality-gate${job.runId ? `&runId=${job.runId}` : ""}`;
                                }
                                if (job.type === "PATTERN_ANALYSIS") {
                                  return `/projects/${projectId}/research-hub/data?jobType=pattern-analysis${job.runId ? `&runId=${job.runId}` : ""}`;
                                }
                                return `/projects/${projectId}/research/data/${job.id}${job.runId ? `?runId=${job.runId}` : ""}`;
                              })()}
                              className="btn btn-secondary !min-h-[32px] px-4 text-label"
                            >
                              View Data
                            </Link>
                          ) : (
                            <span className="text-muted opacity-30">—</span>
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
