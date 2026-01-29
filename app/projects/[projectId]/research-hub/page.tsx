"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";

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

// Modal form data types
interface CustomerResearchFormData {
  productName: string;
  productProblemSolved: string;
  productAmazonAsin: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
}

interface AdCollectionFormData {
  industryCode: string;
}

interface ProductCollectionFormData {
  productName: string;
  productUrl: string;
  competitorUrls: string[];
}

export default function ResearchHubPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Modal states
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [pendingStep, setPendingStep] = useState<{ step: ResearchStep; trackKey: string } | null>(null);

  // Load jobs on mount
  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [projectId]);

  // Auto-refresh jobs every 5 seconds
  useEffect(() => {
    if (!projectId) return;
    
    const interval = setInterval(() => {
      loadJobs();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [projectId]);

  const loadJobs = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();

      if (data.success) {
        setJobs(data.jobs);
        setLastRefresh(new Date());
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
      enabled: true,
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

    // Special handling for customer-analysis: check if ANY completed customer research exists
    if (step.id === "customer-analysis") {
      const hasCompletedResearch = jobs.some(
        (j) => j.type === "CUSTOMER_RESEARCH" && j.status === "COMPLETED"
      );
      return hasCompletedResearch;
    }

    // Default: check prerequisite step status
    const prerequisiteStep = track.steps.find((s) => s.id === step.prerequisite);
    return prerequisiteStep?.status === "COMPLETED";
  };

  // Run a step - show modal or execute directly
  const runStep = async (step: ResearchStep, trackKey: string) => {
    if (!canRun(step, updatedTracks.find((t) => t.key === trackKey)!)) return;

    // Show modal for steps that need input
    if (step.id === "customer-research") {
      setPendingStep({ step, trackKey });
      setShowCustomerModal(true);
      return;
    } else if (step.id === "ad-collection") {
      setPendingStep({ step, trackKey });
      setShowAdModal(true);
      return;
    } else if (step.id === "product-collection") {
      setPendingStep({ step, trackKey });
      setShowProductModal(true);
      return;
    }

    // Execute directly for steps without input
    await executeStep(step, {});
  };

  // Execute step with payload
  const executeStep = async (step: ResearchStep, formData: any) => {
    setRunningStep(step.id);

    try {
      let payload: any = { projectId, ...formData };

      // Add step-specific data
      if (step.id === "customer-analysis") {
        // Pass runId if available
        if (currentRunId) {
          payload.runId = currentRunId;
        }
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
      toast.success("Job started successfully!");
    } catch (error: any) {
      console.error(`Failed to run ${step.label}:`, error);
      toast.error(error.message || "Failed to start job");
    } finally {
      setRunningStep(null);
    }
  };

  // Handle modal submissions
  const handleCustomerResearchSubmit = async (formData: CustomerResearchFormData) => {
    if (!pendingStep) return;
    
    const payload = {
      productName: formData.productName,
      productProblemSolved: formData.productProblemSolved,
      productAmazonAsin: formData.productAmazonAsin,
      ...(formData.competitor1Asin && { competitor1Asin: formData.competitor1Asin }),
      ...(formData.competitor2Asin && { competitor2Asin: formData.competitor2Asin }),
    };

    setShowCustomerModal(false);
    await executeStep(pendingStep.step, payload);
    setPendingStep(null);
  };

  const handleAdCollectionSubmit = async (formData: AdCollectionFormData) => {
    if (!pendingStep) return;
    
    setShowAdModal(false);
    await executeStep(pendingStep.step, { industryCode: formData.industryCode });
    setPendingStep(null);
  };

  const handleProductCollectionSubmit = async (formData: ProductCollectionFormData) => {
    if (!pendingStep) return;
    
    const payload = {
      productName: formData.productName,
      productUrl: formData.productUrl,
      competitorUrls: formData.competitorUrls.filter(url => url.trim() !== ''),
    };

    setShowProductModal(false);
    await executeStep(pendingStep.step, payload);
    setPendingStep(null);
  };

  // Spinner component
  const Spinner = () => {
    return (
      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
      </svg>
    );
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
    <>
      {/* Customer Research Modal */}
      {showCustomerModal && (
        <CustomerResearchModal
          onSubmit={handleCustomerResearchSubmit}
          onClose={() => {
            setShowCustomerModal(false);
            setPendingStep(null);
          }}
        />
      )}

      {/* Ad Collection Modal */}
      {showAdModal && (
        <AdCollectionModal
          onSubmit={handleAdCollectionSubmit}
          onClose={() => {
            setShowAdModal(false);
            setPendingStep(null);
          }}
        />
      )}

      {/* Product Collection Modal */}
      {showProductModal && (
        <ProductCollectionModal
          onSubmit={handleProductCollectionSubmit}
          onClose={() => {
            setShowProductModal(false);
            setPendingStep(null);
          }}
        />
      )}

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
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white mb-2">Research Hub</h1>
            <div className="flex items-center gap-3">
              <p className="text-slate-400">
                Build a comprehensive understanding of your customers, ads, and product
              </p>
              {lastRefresh && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>
                    Updated {Math.floor((new Date().getTime() - lastRefresh.getTime()) / 1000)}s ago
                  </span>
                </div>
              )}
            </div>
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

                          {/* Running Indicator */}
                          {step.status === "RUNNING" && (
                            <div className="mt-3 flex items-center gap-2 text-sky-400">
                              <Spinner />
                              <span className="text-xs">Processing...</span>
                            </div>
                          )}

                          {/* Error Display */}
                          {step.status === "FAILED" && step.lastJob?.error && (
                            <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-red-300 mb-1">Error Details:</p>
                                  <p className="text-xs text-red-400">{step.lastJob.error}</p>
                                </div>
                                <button
                                  onClick={() => runStep(step, track.key)}
                                  className="text-xs text-red-400 hover:text-red-300 underline whitespace-nowrap"
                                >
                                  Try again →
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action Button */}
                        <div className="flex-shrink-0">
                          {step.status === "COMPLETED" ? (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={isRunning}
                              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2"
                            >
                              {isRunning && <Spinner />}
                              Re-run
                            </button>
                          ) : (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={locked || isRunning}
                              className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 ${
                                locked || isRunning
                                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                                  : `bg-${track.color}-500 hover:bg-${track.color}-400 text-white`
                              }`}
                            >
                              {isRunning && <Spinner />}
                              {isRunning ? "Starting..." : locked ? "🔒 Locked" : "Run"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
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

      {/* Recent Jobs */}
      <div className="mt-8 border-t border-slate-800 pt-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Recent Jobs</h2>
        <div className="space-y-2">
          {jobs.slice(0, 10).map(job => (
            <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-800">
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-200">{job.type}</div>
                <div className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()}</div>
              </div>
              <div className={`px-2 py-1 rounded text-xs ${
                job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                job.status === 'FAILED' ? 'bg-red-500/10 text-red-400' :
                job.status === 'RUNNING' ? 'bg-sky-500/10 text-sky-400' :
                'bg-slate-500/10 text-slate-400'
              }`}>
                {job.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    <Toaster position="top-right" />
    </>
  );
}

// Customer Research Modal Component
function CustomerResearchModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: CustomerResearchFormData) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<CustomerResearchFormData>({
    productName: "",
    productProblemSolved: "",
    productAmazonAsin: "",
    competitor1Asin: "",
    competitor2Asin: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productName || !formData.productProblemSolved || !formData.productAmazonAsin) {
      alert("Please fill in all required fields");
      return;
    }
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Customer Research</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your product details to collect customer insights
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.productName}
                onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., Wireless Headphones"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product Problem Solved <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.productProblemSolved}
                onChange={(e) => setFormData({ ...formData, productProblemSolved: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., Provides noise cancellation for focus"
                rows={3}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Amazon ASIN <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.productAmazonAsin}
                onChange={(e) => setFormData({ ...formData, productAmazonAsin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., B07XYZ1234"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Competitor 1 ASIN <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.competitor1Asin}
                onChange={(e) => setFormData({ ...formData, competitor1Asin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., B08ABC5678"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Competitor 2 ASIN <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.competitor2Asin}
                onChange={(e) => setFormData({ ...formData, competitor2Asin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., B09DEF9012"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-medium"
              >
                Start Research
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Ad Collection Modal Component
function AdCollectionModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: AdCollectionFormData) => void;
  onClose: () => void;
}) {
  const [industryCode, setIndustryCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!industryCode) {
      alert("Please enter an industry code");
      return;
    }
    onSubmit({ industryCode });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Ad Collection</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your industry code to collect relevant ads
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Industry Code <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={industryCode}
                onChange={(e) => setIndustryCode(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="e.g., tech, fitness, beauty"
                required
              />
              <p className="mt-2 text-xs text-slate-500">
                Enter a code that represents your industry or niche
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded bg-sky-500 hover:bg-sky-400 text-white font-medium"
              >
                Collect Ads
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Product Collection Modal Component
function ProductCollectionModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: ProductCollectionFormData) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<ProductCollectionFormData>({
    productName: "",
    productUrl: "",
    competitorUrls: [""],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productName || !formData.productUrl) {
      alert("Please fill in all required fields");
      return;
    }
    onSubmit(formData);
  };

  const addCompetitorUrl = () => {
    setFormData({
      ...formData,
      competitorUrls: [...formData.competitorUrls, ""],
    });
  };

  const removeCompetitorUrl = (index: number) => {
    setFormData({
      ...formData,
      competitorUrls: formData.competitorUrls.filter((_, i) => i !== index),
    });
  };

  const updateCompetitorUrl = (index: number, value: string) => {
    const newUrls = [...formData.competitorUrls];
    newUrls[index] = value;
    setFormData({ ...formData, competitorUrls: newUrls });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Product Collection</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your product details and competitor URLs
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.productName}
                onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="e.g., Smart Watch Pro"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={formData.productUrl}
                onChange={(e) => setFormData({ ...formData, productUrl: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="https://example.com/product"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Competitor URLs <span className="text-slate-500">(optional)</span>
              </label>
              <div className="space-y-2">
                {formData.competitorUrls.map((url, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => updateCompetitorUrl(index, e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      placeholder="https://competitor.com/product"
                    />
                    {formData.competitorUrls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCompetitorUrl(index)}
                        className="px-3 py-2 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCompetitorUrl}
                  className="text-sm text-violet-400 hover:text-violet-300"
                >
                  + Add another competitor URL
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded bg-violet-500 hover:bg-violet-400 text-white font-medium"
              >
                Collect Data
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
