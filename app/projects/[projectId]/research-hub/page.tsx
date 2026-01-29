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
  error?: string;
  result?: any;
  metadata?: any;
  payload?: any;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface ResearchStep {
  id: string;
  label: string;
  description: string;
  jobType: JobType;
  endpoint: string;
  prerequisite?: string;
  status: JobStatus;
  lastJob?: Job;
}

interface ResearchTrack {
  key: string;
  label: string;
  description: string;
  color: string;
  steps: ResearchStep[];
  enabled: boolean;
}

export default function ResearchHubPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Load jobs on mount
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
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error("Failed to load jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  // Define research tracks
  const tracks: ResearchTrack[] = [
    {
      key: "customer",
      label: "Customer Research",
      description: "Understand your target customers",
      color: "emerald",
      enabled: true,
      steps: [
        {
          id: "customer-research",
          label: "Collect Customer Data",
          description: "Gather Reddit discussions and Amazon reviews",
          jobType: "CUSTOMER_RESEARCH",
          endpoint: "/api/jobs/customer-research",
          status: "NOT_STARTED",
        },
        {
          id: "customer-analysis",
          label: "Analyze Customer Insights",
          description: "Generate customer avatars and pain points",
          jobType: "CUSTOMER_ANALYSIS",
          endpoint: "/api/jobs/customer-analysis",
          prerequisite: "customer-research",
          status: "NOT_STARTED",
        },
      ],
    },
    {
      key: "ad",
      label: "Ad Research",
      description: "Analyze successful ad patterns",
      color: "sky",
      enabled: true,
      steps: [
        {
          id: "ad-collection",
          label: "Collect Ads",
          description: "Gather raw ads from your industry",
          jobType: "AD_PERFORMANCE",
          endpoint: "/api/jobs/ad-collection",
          status: "NOT_STARTED",
        },
        {
          id: "ad-transcripts",
          label: "Extract Transcripts",
          description: "Convert ads to text transcripts",
          jobType: "AD_PERFORMANCE",
          endpoint: "/api/jobs/ad-transcripts",
          prerequisite: "ad-collection",
          status: "NOT_STARTED",
        },
        {
          id: "pattern-analysis",
          label: "Analyze Patterns",
          description: "Identify winning ad patterns",
          jobType: "PATTERN_ANALYSIS",
          endpoint: "/api/jobs/pattern-analysis",
          prerequisite: "ad-transcripts",
          status: "NOT_STARTED",
        },
      ],
    },
    {
      key: "product",
      label: "Product Research",
      description: "Deep dive into your product features",
      color: "violet",
      enabled: false, // Coming soon
      steps: [
        {
          id: "product-collection",
          label: "Collect Product Data",
          description: "Gather product information and features",
          jobType: "PRODUCT_DATA_COLLECTION",
          endpoint: "/api/jobs/product-data-collection",
          status: "NOT_STARTED",
        },
        {
          id: "product-analysis",
          label: "Analyze Product",
          description: "Generate product insights",
          jobType: "PRODUCT_ANALYSIS",
          endpoint: "/api/jobs/product-analysis",
          prerequisite: "product-collection",
          status: "NOT_STARTED",
        },
      ],
    },
  ];

  // Update step statuses based on jobs
  const updatedTracks = tracks.map((track) => ({
    ...track,
    steps: track.steps.map((step) => {
      const relevantJobs = jobs.filter((j) => {
        if (step.jobType === "AD_PERFORMANCE") {
          // Special handling for ad jobs which share the same type
          const jobSubtype = j.payload?.jobType || j.metadata?.jobType;
          if (step.id === "ad-collection") return jobSubtype === "ad_raw_collection";
          if (step.id === "ad-transcripts") return jobSubtype === "ad_transcripts";
        }
        return j.type === step.jobType;
      });

      const lastJob = relevantJobs[0];
      const status = lastJob?.status || "NOT_STARTED";

      return {
        ...step,
        status: status as JobStatus,
        lastJob,
      };
    }),
  }));

  // Calculate completion percentage
  const calculateCompletion = (track: ResearchTrack): number => {
    const completed = track.steps.filter((s) => s.status === "COMPLETED").length;
    return Math.round((completed / track.steps.length) * 100);
  };

  // Check if step can run
  const canRun = (step: ResearchStep, track: ResearchTrack): boolean => {
    if (step.status === "RUNNING" || step.status === "PENDING") return false;

    if (!step.prerequisite) return true;

    const prerequisiteStep = track.steps.find((s) => s.id === step.prerequisite);
    return prerequisiteStep?.status === "COMPLETED";
  };

  // Run a step
  const runStep = async (step: ResearchStep, trackKey: string) => {
    if (!canRun(step, updatedTracks.find((t) => t.key === trackKey)!)) return;

    setRunningStep(step.id);

    try {
      let payload: any = { projectId };

      // Add step-specific data
      if (step.id === "customer-research") {
        // TODO: Get from form/modal
        payload = {
          projectId,
          productName: "Sample Product",
          productProblemSolved: "Sample Problem",
          productAmazonAsin: "B07XYZ1234",
        };
      } else if (step.id === "customer-analysis") {
        // Pass runId if available
        if (currentRunId) {
          payload.runId = currentRunId;
        }
      } else if (step.id === "ad-collection") {
        // TODO: Get from form/modal
        payload.industryCode = "default";
      }

      const response = await fetch(step.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!data.success && !response.ok) {
        throw new Error(data.error || "Failed to start job");
      }

      // Store runId from customer research
      if (step.id === "customer-research" && data.runId) {
        setCurrentRunId(data.runId);
      }

      // Reload jobs to see the new job
      await loadJobs();
    } catch (error: any) {
      console.error(`Failed to run ${step.label}:`, error);
      alert(`Error: ${error.message}`);
    } finally {
      setRunningStep(null);
    }
  };

  // Status badge
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
        <p className="text-sm text-slate-400">Loading research hub...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-slate-400 hover:text-slate-300 mb-2 inline-block"
        >
          ← Back to Project
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Research Hub</h1>
            <p className="text-slate-400">
              Build a comprehensive understanding of your customers, ads, and product
            </p>
          </div>
          {currentRunId && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-slate-500 mb-1">Current Research Run</div>
                <div className="text-sm font-mono text-emerald-400">{currentRunId.slice(0, 8)}...</div>
              </div>
              <button
                onClick={() => setCurrentRunId(null)}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
              >
                Start New Run
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Research Tracks */}
      <div className="space-y-8">
        {updatedTracks.map((track) => {
          const completion = calculateCompletion(track);
          const colorClasses = {
            emerald: "border-emerald-500/50 bg-emerald-500/5",
            sky: "border-sky-500/50 bg-sky-500/5",
            violet: "border-violet-500/50 bg-violet-500/5",
          }[track.color];

          return (
            <div
              key={track.key}
              className={`rounded-lg border ${colorClasses} p-6 ${
                !track.enabled ? "opacity-50" : ""
              }`}
            >
              {/* Track Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">{track.label}</h2>
                  <p className="text-sm text-slate-400">{track.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-white">{completion}%</div>
                  <div className="text-xs text-slate-500">Complete</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-6 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-${track.color}-500 transition-all duration-500`}
                  style={{ width: `${completion}%` }}
                />
              </div>

              {/* Steps */}
              {track.enabled ? (
                <div className="space-y-4">
                  {track.steps.map((step, idx) => {
                    const locked = !canRun(step, track);
                    const isRunning = runningStep === step.id;

                    return (
                      <div
                        key={step.id}
                        className="flex items-start gap-4 p-4 rounded-lg bg-slate-900/50 border border-slate-800"
                      >
                        {/* Step Number */}
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400">
                            {idx + 1}
                          </div>
                        </div>

                        {/* Step Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white mb-1">
                            {step.label}
                          </h3>
                          <p className="text-xs text-slate-400 mb-2">{step.description}</p>
                          <StatusBadge status={step.status} />

                          {/* Error Display */}
                          {step.status === "FAILED" && step.lastJob?.error && (
                            <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/50">
                              <p className="text-xs text-red-400">{step.lastJob.error}</p>
                            </div>
                          )}
                        </div>

                        {/* Action Button */}
                        <div className="flex-shrink-0">
                          {step.status === "COMPLETED" ? (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={isRunning}
                              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm"
                            >
                              Re-run
                            </button>
                          ) : (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={locked || isRunning}
                              className={`px-4 py-2 rounded text-sm font-medium ${
                                locked || isRunning
                                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                                  : `bg-${track.color}-500 hover:bg-${track.color}-400 text-white`
                              }`}
                            >
                              {isRunning ? "Starting..." : locked ? "🔒 Locked" : "Run"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-slate-500 mb-2">Coming Soon</p>
                  <p className="text-xs text-slate-600">
                    This research track is under development
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Next Step CTA */}
      <div className="mt-8 p-6 rounded-lg bg-slate-900/50 border border-slate-800">
        <h3 className="text-lg font-bold text-white mb-2">Ready for Production?</h3>
        <p className="text-sm text-slate-400 mb-4">
          Once you've completed your research, head to the Creative Studio to generate
          ad scripts and videos.
        </p>
        <Link
          href={`/projects/${projectId}/creative-studio`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium"
        >
          Go to Creative Studio →
        </Link>
      </div>
    </div>
  );
}
