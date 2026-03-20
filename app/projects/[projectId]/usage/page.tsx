"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import GlobalNavMenu from "@/components/GlobalNavMenu";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusChip } from "@/components/ui";
import { getJobTypeLabel } from "@/lib/jobLabels";

type JobType = string;

type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  runId?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  costBreakdown?: any;
  payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

interface JobTypeBreakdown {
  [key: string]: number;
}

function getDisplayJobLabel(job: Job): string {
  if (job.type === "AD_PERFORMANCE") {
    const subtype = String(job.payload?.jobType || job.metadata?.jobType || "").trim();
    if (subtype === "ad_ocr_collection") return "Extract OCR";
    if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
      return "Extract Transcripts";
    }
    return "Ad Collection";
  }

  return getJobTypeLabel(job.type);
}

function getBreakdownKey(job: Job): string {
  if (job.type !== "AD_PERFORMANCE") return job.type;

  const subtype = String(job.payload?.jobType || job.metadata?.jobType || "").trim();
  if (subtype === "ad_ocr_collection") return "AD_PERFORMANCE:ad_ocr_collection";
  if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
    return "AD_PERFORMANCE:ad_transcripts";
  }
  return "AD_PERFORMANCE:ad_raw_collection";
}

function getBreakdownLabel(key: string): string {
  if (key === "AD_PERFORMANCE:ad_ocr_collection") return "Extract OCR";
  if (key === "AD_PERFORMANCE:ad_transcripts") return "Extract Transcripts";
  if (key === "AD_PERFORMANCE:ad_raw_collection") return "Ad Collection";
  return getJobTypeLabel(key);
}

export default function UsagePage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dateFilter, setDateFilter] = useState<string>("all");

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();

      if (data.success) {
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error("Failed to load jobs:", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [loadJobs, projectId]);

  // Filter jobs by date
  const getFilteredJobs = () => {
    if (dateFilter === "all") return jobs;

    const now = new Date();
    const filterDate = new Date();

    switch (dateFilter) {
      case "today":
        filterDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        filterDate.setDate(now.getDate() - 7);
        break;
      case "month":
        filterDate.setMonth(now.getMonth() - 1);
        break;
      default:
        return jobs;
    }

    return jobs.filter((job) => new Date(job.createdAt) >= filterDate);
  };

  const filteredJobs = getFilteredJobs();

  // Calculate totals
  const totalSpend = filteredJobs.reduce((sum, j) => sum + (j.actualCost || 0), 0);

  const byJobType: JobTypeBreakdown = filteredJobs.reduce((acc, j) => {
    const key = getBreakdownKey(j);
    acc[key] = (acc[key] || 0) + (j.actualCost || 0);
    return acc;
  }, {} as JobTypeBreakdown);

  const formatCost = (costCents: number): string => {
    const dollars = Number(costCents ?? 0) / 100;
    return `$${dollars.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return <LoadingState title="Loading usage data" variant="page" />;
  }

  return (
    <>
      <GlobalNavMenu projectId={projectId} />
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Usage & Metrics"
          description="Track your research job spending and resource allocation."
        />

      {/* Total Spend Card */}
      <SectionCard className="overflow-hidden relative group p-10">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-50" />
        <div className="relative text-center space-y-3">
          <p className="text-body-sm font-mono text-muted uppercase tracking-[0.2em] opacity-70">Total Platform Spend</p>
          <p className="text-6xl font-bold text-white tracking-tight drop-shadow-sm">{formatCost(totalSpend)}</p>
          <div className="inline-flex items-center px-3 py-1 rounded-pill bg-transparent border border-line text-label font-mono text-muted uppercase tracking-wider">
            {filteredJobs.length} {filteredJobs.length === 1 ? 'JOB' : 'JOBS'} RECORDED
          </div>
        </div>
      </SectionCard>

      {/* Date Filter */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-pill bg-panel border border-line w-fit">
        <button
          onClick={() => setDateFilter("all")}
          className={`btn btn-secondary !min-h-[36px] px-6 ${
            dateFilter === "all"
              ? "bg-accent text-bg border-transparent"
              : ""
          }`}
        >
          All Time
        </button>
        <button
          onClick={() => setDateFilter("today")}
          className={`btn btn-secondary !min-h-[36px] px-6 ${
            dateFilter === "today"
              ? "bg-accent text-bg border-transparent"
              : ""
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setDateFilter("week")}
          className={`btn btn-secondary !min-h-[36px] px-6 ${
            dateFilter === "week"
              ? "bg-accent text-bg border-transparent"
              : ""
          }`}
        >
          Last 7 Days
        </button>
        <button
          onClick={() => setDateFilter("month")}
          className={`btn btn-secondary !min-h-[36px] px-6 ${
            dateFilter === "month"
              ? "bg-accent text-bg border-transparent"
              : ""
          }`}
        >
          Last 30 Days
        </button>
      </div>

      {/* Breakdown by Job Type */}
      <div className="space-y-4">
        <p className="eyebrow">Breakdown By Job Type</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(byJobType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, cost]) => {
              const percentage = totalSpend > 0 ? (cost / totalSpend) * 100 : 0;
              return (
                <div
                  key={type}
                  className="px-5 py-4"
                >
                  <SectionCard className="h-full" padding="none">
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-bold text-white tracking-tight">
                          {getBreakdownLabel(type)}
                        </p>
                        <p className="text-sm font-mono font-bold text-accent-2">{formatCost(cost)}</p>
                      </div>
                      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent-2 shadow-panel"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <p className="text-label font-mono text-muted mt-2 uppercase opacity-60">{percentage.toFixed(1)}% OF TOTAL SPEND</p>
                    </div>
                  </SectionCard>
                </div>
              );
            })}
        </div>
      </div>

      {/* Jobs Table */}
      <div className="space-y-4">
        <p className="eyebrow">Financial Record</p>
        <SectionCard padding="none" className="overflow-hidden">
          <table className="w-full">
            <thead className="bg-bg-elevated border-b border-line">
              <tr>
                <th className="px-5 py-3 text-left text-label font-mono text-muted uppercase tracking-widest">
                  Date
                </th>
                <th className="px-5 py-3 text-left text-label font-mono text-muted uppercase tracking-widest">
                  Job Type
                </th>
                <th className="px-5 py-3 text-left text-label font-mono text-muted uppercase tracking-widest">
                  Run ID
                </th>
                <th className="px-5 py-3 text-left text-label font-mono text-muted uppercase tracking-widest">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-label font-mono text-muted uppercase tracking-widest">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
               {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12">
                    <EmptyState title="No matching ledger entries found" />
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-bg-elevated transition-colors">
                    <td className="px-5 py-4 text-xs text-text font-mono">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-white tracking-tight">
                      {getDisplayJobLabel(job)}
                    </td>
                    <td className="px-5 py-4 text-label font-mono text-muted uppercase opacity-60">
                      {job.runId ? job.runId.slice(0, 8) : "-"}
                    </td>
                    <td className="px-5 py-4">
                      <StatusChip
                        variant={
                          job.status === "COMPLETED"
                            ? "success"
                            : job.status === "FAILED"
                              ? "danger"
                              : "info"
                        }
                        className={job.status !== "COMPLETED" && job.status !== "FAILED" ? "opacity-60" : ""}
                      >
                        {job.status}
                      </StatusChip>
                    </td>
                    <td className="px-5 py-4 text-sm text-right font-mono font-bold text-white">
                      {formatCost(job.actualCost || 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      </div>

      {/* Note about mock costs */}
      <div className="p-5 rounded-card bg-accent/5 border border-accent/20 backdrop-blur-panel">
        <p className="text-xs text-accent italic">
          <strong className="uppercase tracking-widest mr-2 opacity-70">Note:</strong> 
          Metrics shown are ledger simulations. Actual API resource allocation is tracked post-aggregation.
        </p>
      </div>
      </div>
    </>
  );
}
