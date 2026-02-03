"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";

type JobType =
  | "CUSTOMER_RESEARCH"
  | "CUSTOMER_ANALYSIS"
  | "AD_PERFORMANCE"
  | "PATTERN_ANALYSIS"
  | "PRODUCT_DATA_COLLECTION"
  | "PRODUCT_ANALYSIS";

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
}

interface JobTypeBreakdown {
  [key: string]: number;
}

export default function UsagePage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dateFilter, setDateFilter] = useState<string>("all");

  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [projectId]);

  const loadJobs = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();

      if (data.success) {
        // Add mock costs for jobs that don't have them
        const jobsWithCosts = data.jobs.map((job: Job) => ({
          ...job,
          actualCost: job.actualCost || getMockCost(job.type, job.status),
        }));
        setJobs(jobsWithCosts);
      }
    } catch (error) {
      console.error("Failed to load jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  // Mock cost calculation (replace with real API costs later)
  const getMockCost = (type: JobType, status: JobStatus): number => {
    if (status !== "COMPLETED") return 0;

    const costs: Record<JobType, number> = {
      CUSTOMER_RESEARCH: 0.65,
      CUSTOMER_ANALYSIS: 0.15,
      AD_PERFORMANCE: 0.45,
      PATTERN_ANALYSIS: 0.25,
      PRODUCT_DATA_COLLECTION: 0.35,
      PRODUCT_ANALYSIS: 0.20,
    };

    return costs[type] || 0;
  };

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
    acc[j.type] = (acc[j.type] || 0) + (j.actualCost || 0);
    return acc;
  }, {} as JobTypeBreakdown);

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="px-6 py-6 flex items-center justify-center min-h-screen">
        <p className="text-sm text-slate-400">Loading usage data...</p>
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
        <h1 className="text-3xl font-bold text-white mb-2">Usage & Costs</h1>
        <p className="text-slate-400">Track your research job spending and usage</p>
      </div>

      {/* Total Spend Card */}
      <div className="mb-8 p-8 rounded-lg bg-gradient-to-br from-emerald-500/10 to-sky-500/10 border border-emerald-500/30">
        <div className="text-center">
          <p className="text-sm text-slate-400 mb-2">Total Spend</p>
          <p className="text-5xl font-bold text-white mb-1">{formatCost(totalSpend)}</p>
          <p className="text-xs text-slate-500">{filteredJobs.length} jobs</p>
        </div>
      </div>

      {/* Date Filter */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setDateFilter("all")}
          className={`px-4 py-2 rounded text-sm ${
            dateFilter === "all"
              ? "bg-emerald-500 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          All Time
        </button>
        <button
          onClick={() => setDateFilter("today")}
          className={`px-4 py-2 rounded text-sm ${
            dateFilter === "today"
              ? "bg-emerald-500 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setDateFilter("week")}
          className={`px-4 py-2 rounded text-sm ${
            dateFilter === "week"
              ? "bg-emerald-500 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Last 7 Days
        </button>
        <button
          onClick={() => setDateFilter("month")}
          className={`px-4 py-2 rounded text-sm ${
            dateFilter === "month"
              ? "bg-emerald-500 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Last 30 Days
        </button>
      </div>

      {/* Breakdown by Job Type */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-white mb-4">Breakdown by Job Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(byJobType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, cost]) => {
              const percentage = totalSpend > 0 ? (cost / totalSpend) * 100 : 0;
              return (
                <div
                  key={type}
                  className="p-4 rounded-lg bg-slate-900/50 border border-slate-800"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-300">
                      {getJobTypeLabel(type)}
                    </p>
                    <p className="text-sm font-bold text-emerald-400">{formatCost(cost)}</p>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{percentage.toFixed(1)}% of total</p>
                </div>
              );
            })}
        </div>
      </div>

      {/* Jobs Table */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-white mb-4">Job History</h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Job Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Run ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                    No jobs found for the selected period
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {getJobTypeLabel(job.type)}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-400">
                      {job.runId ? job.runId.slice(0, 8) + "..." : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          job.status === "COMPLETED"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : job.status === "FAILED"
                            ? "bg-red-500/10 text-red-400"
                            : job.status === "RUNNING"
                            ? "bg-sky-500/10 text-sky-400"
                            : "bg-slate-500/10 text-slate-400"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-emerald-400">
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
      <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
        <p className="text-sm text-yellow-400">
          <strong>Note:</strong> Costs shown are estimates. Actual API costs will be tracked in
          production.
        </p>
      </div>
    </div>
  );
}
