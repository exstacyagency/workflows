"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

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
  resultSummary?: any;
  payload?: any;
  createdAt: string;
  updatedAt: string;
}

export default function JobResultsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;
  const jobId = params?.jobId as string;

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && jobId) {
      loadJob();
    }
  }, [projectId, jobId]);

  const loadJob = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}`);
      const data = await response.json();

      if (data.success) {
        setJob(data.job);
      } else {
        setError(data.error || "Failed to load job");
      }
    } catch (err: any) {
      console.error("Failed to load job:", err);
      setError(err.message || "Failed to load job");
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

  const StatusBadge = ({ status }: { status: JobStatus }) => {
    const colors = {
      NOT_STARTED: "bg-slate-500/20 text-slate-400",
      PENDING: "bg-yellow-500/20 text-yellow-400",
      RUNNING: "bg-sky-500/20 text-sky-400",
      COMPLETED: "bg-emerald-500/20 text-emerald-400",
      FAILED: "bg-red-500/20 text-red-400",
    };

    return (
      <span className={`px-3 py-1 rounded text-sm font-medium ${colors[status]}`}>
        {status.replace("_", " ")}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="px-6 py-6 flex items-center justify-center min-h-screen">
        <p className="text-sm text-slate-400">Loading job results...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="px-6 py-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/projects/${projectId}/research-hub`}
            className="text-sm text-slate-400 hover:text-slate-300"
          >
            ← Back to Research Hub
          </Link>
        </div>
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6">
          <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Job</h2>
          <p className="text-sm text-red-300">{error || "Job not found"}</p>
        </div>
      </div>
    );
  }

  const getJobTypeLabel = (type: JobType): string => {
    const labels: Record<JobType, string> = {
      CUSTOMER_RESEARCH: "Customer Research",
      CUSTOMER_ANALYSIS: "Customer Analysis",
      AD_PERFORMANCE: "Ad Performance",
      PATTERN_ANALYSIS: "Pattern Analysis",
      PRODUCT_DATA_COLLECTION: "Product Data Collection",
      PRODUCT_ANALYSIS: "Product Analysis",
    };
    return labels[type] || type;
  };

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => router.push(`/projects/${projectId}/research-hub/jobs/${job.type}`)}
            className="text-slate-400 hover:text-slate-300 text-sm"
          >
            ← Back to {getJobTypeLabel(job.type)} Jobs
          </button>
          <span className="text-slate-600">|</span>
          <Link
            href={`/projects/${projectId}/research-hub`}
            className="text-sm text-slate-400 hover:text-slate-300"
          >
            Research Hub
          </Link>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Job Results</h1>
            <p className="text-slate-400">{getJobTypeLabel(job.type)}</p>
          </div>
          <StatusBadge status={job.status} />
        </div>
      </div>

      {/* Job Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-xs text-slate-500 mb-1">Job ID</div>
          <div className="text-sm font-mono text-slate-300">{job.id}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-xs text-slate-500 mb-1">Created</div>
          <div className="text-sm text-slate-300">{formatDate(job.createdAt)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="text-xs text-slate-500 mb-1">Duration</div>
          <div className="text-sm text-slate-300">{formatDuration(job.createdAt, job.updatedAt)}</div>
        </div>
      </div>

      {/* Result Summary */}
      {job.resultSummary && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Result Summary</h2>
          <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/5 p-6">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap overflow-x-auto">
              {typeof job.resultSummary === 'string' 
                ? job.resultSummary 
                : JSON.stringify(job.resultSummary, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Payload Data */}
      {job.payload && Object.keys(job.payload).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Input Parameters</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
            <pre className="text-xs text-slate-300 overflow-x-auto">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Error Display */}
      {job.status === "FAILED" && job.error && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Error Details</h2>
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6">
            <pre className="text-sm text-red-300 whitespace-pre-wrap overflow-x-auto">
              {typeof job.error === 'string' 
                ? job.error 
                : JSON.stringify(job.error, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Related Records */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-white mb-4">Related Records</h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-sm text-slate-400 mb-4">
            View related data in the database for this job:
          </p>
          <div className="space-y-2">
            {job.type === "CUSTOMER_RESEARCH" && (
              <>
                <Link
                  href={`/projects/${projectId}/data/reddit-posts`}
                  className="block text-sm text-sky-400 hover:text-sky-300 underline"
                >
                  → View Reddit Posts
                </Link>
                <Link
                  href={`/projects/${projectId}/data/amazon-reviews`}
                  className="block text-sm text-sky-400 hover:text-sky-300 underline"
                >
                  → View Amazon Reviews
                </Link>
              </>
            )}
            {job.type === "CUSTOMER_ANALYSIS" && (
              <>
                <Link
                  href={`/projects/${projectId}/data/customer-avatars`}
                  className="block text-sm text-sky-400 hover:text-sky-300 underline"
                >
                  → View Customer Avatars
                </Link>
                <Link
                  href={`/projects/${projectId}/data/pain-points`}
                  className="block text-sm text-sky-400 hover:text-sky-300 underline"
                >
                  → View Pain Points
                </Link>
              </>
            )}
            {job.type === "AD_PERFORMANCE" && (
              <Link
                href={`/projects/${projectId}/data/ads`}
                className="block text-sm text-sky-400 hover:text-sky-300 underline"
              >
                → View Collected Ads
              </Link>
            )}
            {job.type === "PATTERN_ANALYSIS" && (
              <Link
                href={`/projects/${projectId}/data/ad-patterns`}
                className="block text-sm text-sky-400 hover:text-sky-300 underline"
              >
                → View Ad Patterns
              </Link>
            )}
            {job.type === "PRODUCT_DATA_COLLECTION" && (
              <Link
                href={`/projects/${projectId}/data/product-data`}
                className="block text-sm text-sky-400 hover:text-sky-300 underline"
              >
                → View Product Data
              </Link>
            )}
            {job.type === "PRODUCT_ANALYSIS" && (
              <Link
                href={`/projects/${projectId}/data/product-insights`}
                className="block text-sm text-sky-400 hover:text-sky-300 underline"
              >
                → View Product Insights
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <Link
          href={`/projects/${projectId}/research-hub`}
          className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
        >
          Back to Research Hub
        </Link>
        <Link
          href={`/projects/${projectId}/creative-studio`}
          className="px-4 py-2 rounded bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium"
        >
          Go to Creative Studio →
        </Link>
      </div>
    </div>
  );
}
