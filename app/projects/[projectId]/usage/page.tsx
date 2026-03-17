"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
    return (
      <div className="px-6 py-6 flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-mono text-muted uppercase tracking-widest">Loading usage data...</p>
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
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Usage & Metrics</h1>
        <p className="text-sm text-muted">Track your research job spending and resource allocation.</p>
      </div>

      {/* Total Spend Card */}
      <div className="p-10 rounded-card border border-line bg-panel shadow-panel backdrop-blur-panel overflow-hidden relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-50" />
        <div className="relative text-center space-y-3">
          <p className="text-[11px] font-mono text-muted uppercase tracking-[0.2em] opacity-70">Total Platform Spend</p>
          <p className="text-6xl font-bold text-white tracking-tight drop-shadow-sm">{formatCost(totalSpend)}</p>
          <div className="inline-flex items-center px-3 py-1 rounded-pill bg-panel/5 border border-line text-[10px] font-mono text-muted uppercase tracking-wider">
            {filteredJobs.length} {filteredJobs.length === 1 ? 'JOB' : 'JOBS'} RECORDED
          </div>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-pill bg-panel border border-line w-fit">
        <button
          onClick={() => setDateFilter("all")}
          className={`px-6 py-2 rounded-pill text-[11px] font-bold uppercase tracking-wider transition-all ${
            dateFilter === "all"
              ? "bg-accent text-bg shadow-lg shadow-accent/20"
              : "text-muted hover:text-white hover:bg-panel/5"
          }`}
        >
          All Time
        </button>
        <button
          onClick={() => setDateFilter("today")}
          className={`px-6 py-2 rounded-pill text-[11px] font-bold uppercase tracking-wider transition-all ${
            dateFilter === "today"
              ? "bg-accent text-bg shadow-lg shadow-accent/20"
              : "text-muted hover:text-white hover:bg-panel/5"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setDateFilter("week")}
          className={`px-6 py-2 rounded-pill text-[11px] font-bold uppercase tracking-wider transition-all ${
            dateFilter === "week"
              ? "bg-accent text-bg shadow-lg shadow-accent/20"
              : "text-muted hover:text-white hover:bg-panel/5"
          }`}
        >
          Last 7 Days
        </button>
        <button
          onClick={() => setDateFilter("month")}
          className={`px-6 py-2 rounded-pill text-[11px] font-bold uppercase tracking-wider transition-all ${
            dateFilter === "month"
              ? "bg-accent text-bg shadow-lg shadow-accent/20"
              : "text-muted hover:text-white hover:bg-panel/5"
          }`}
        >
          Last 30 Days
        </button>
      </div>

      {/* Breakdown by Job Type */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-tight">Breakdown by Job Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(byJobType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, cost]) => {
              const percentage = totalSpend > 0 ? (cost / totalSpend) * 100 : 0;
              return (
                <div
                  key={type}
                  className="px-5 py-4 rounded-card border border-line bg-panel shadow-panel backdrop-blur-panel"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-bold text-white tracking-tight">
                      {getBreakdownLabel(type)}
                    </p>
                    <p className="text-[13px] font-mono font-bold text-accent-2">{formatCost(cost)}</p>
                  </div>
                  <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-2 shadow-[0_0_8px_rgba(154,208,255,0.4)]"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <p className="text-[10px] font-mono text-muted mt-2 uppercase opacity-60">{percentage.toFixed(1)}% OF TOTAL SPEND</p>
                </div>
              );
            })}
        </div>
      </div>

      {/* Jobs Table */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-tight">Financial Record</h2>
        <div className="rounded-card border border-line bg-panel overflow-hidden shadow-panel backdrop-blur-panel">
          <table className="w-full">
            <thead className="bg-bg-elevated/50 border-b border-line">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                  Date
                </th>
                <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                  Job Type
                </th>
                <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                  Run ID
                </th>
                <th className="px-5 py-3 text-left text-[10px] font-mono text-muted uppercase tracking-widest">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-[10px] font-mono text-muted uppercase tracking-widest">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
               {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-xs text-muted italic">
                    No matching ledger entries found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-bg-elevated/40 transition-colors">
                    <td className="px-5 py-4 text-xs text-text font-mono">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-[13px] font-bold text-white tracking-tight">
                      {getDisplayJobLabel(job)}
                    </td>
                    <td className="px-5 py-4 text-[10px] font-mono text-muted uppercase opacity-60">
                      {job.runId ? job.runId.slice(0, 8) : "-"}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`status-chip ${
                          job.status === "COMPLETED"
                            ? "success"
                            : job.status === "FAILED"
                            ? "danger"
                            : "info"
                        } ${job.status !== "COMPLETED" && job.status !== "FAILED" ? "opacity-60" : ""}`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-right font-mono font-bold text-white">
                      {formatCost(job.actualCost || 0)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Note about mock costs */}
      <div className="p-5 rounded-card bg-accent/5 border border-accent/20 backdrop-blur-panel">
        <p className="text-xs text-accent italic">
          <strong className="uppercase tracking-widest mr-2 opacity-70">Note:</strong> 
          Metrics shown are ledger simulations. Actual API resource allocation is tracked post-aggregation.
        </p>
      </div>
    </div>
  );
}
