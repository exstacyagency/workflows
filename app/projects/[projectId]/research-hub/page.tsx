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
  resultSummary?: any;
  metadata?: any;
  payload?: any;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  runId?: string | null;
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
  // Reddit search parameters
  redditKeywords: string;
  redditSubreddits?: string;
  maxPosts: number;
  maxCommentsPerPost: number;
  timeRange: 'week' | 'month' | 'year' | 'all';
  scrapeComments: boolean;
}

interface AdCollectionFormData {
  industryCode: string;
}

interface ProductCollectionFormData {
  productName: string;
  productUrl: string;
  competitorUrls: string[];
}

interface RunAllResearchFormData {
  productName: string;
  productProblemSolved: string;
  productAmazonAsin: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
  industryCode: string;
  productUrl: string;
  competitorUrls: string[];
}

export default function ResearchHubPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previousJobs, setPreviousJobs] = useState<Job[]>([]);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());

  // Modal states
  const [activeStepModal, setActiveStepModal] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<{ step: ResearchStep; trackKey: string } | null>(null);
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState<JobType | null>(null);

  // Load jobs on mount
  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [projectId]);

  // Auto-refresh jobs every 5 seconds
  useEffect(() => {
    if (!projectId) return;
    
    console.log('[Auto-refresh] Setting up interval for projectId:', projectId);
    const interval = setInterval(() => {
      console.log('[Auto-refresh] Triggering loadJobs...');
      loadJobs();
    }, 5000);
    
    return () => {
      console.log('[Auto-refresh] Cleaning up interval');
      clearInterval(interval);
    };
  }, [projectId]);

  // Detect job completions and show celebration
  useEffect(() => {
    if (previousJobs.length === 0) return;

    const newCompletions = jobs.filter(job => 
      job.status === 'COMPLETED' && 
      previousJobs.find(prev => prev.id === job.id && prev.status === 'RUNNING')
    );
    
    newCompletions.forEach(job => {
      setRecentlyCompleted(prev => new Set(prev).add(job.id));
      toast.success(`${job.type.replace(/_/g, ' ')} completed!`, {
        duration: 3000,
        icon: '🎉',
      });
      
      // Remove from set after 3 seconds
      setTimeout(() => {
        setRecentlyCompleted(prev => {
          const next = new Set(prev);
          next.delete(job.id);
          return next;
        });
      }, 3000);
    });
  }, [jobs, previousJobs]);

  const loadJobs = async () => {
    console.log('[loadJobs] Starting job fetch...', { projectId, timestamp: new Date().toISOString() });
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();

      console.log('[loadJobs] Fetched jobs:', { 
        success: data.success, 
        jobCount: data.jobs?.length,
        jobs: data.jobs 
      });

      if (data.success) {
        setPreviousJobs(jobs);
        setJobs(data.jobs);
        setLastRefresh(new Date());
        console.log('[loadJobs] Jobs state updated successfully');
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

  // Get step status based on current run
  const getStepStatus = (jobType: JobType, stepId: string): { status: JobStatus; lastJob?: Job } => {
    if (!currentRunId) {
      return { status: "NOT_STARTED" };
    }
    
    // Only look at jobs with the current runId
    let job: Job | undefined;
    
    if (jobType === "AD_PERFORMANCE") {
      // Special handling for ad jobs which share the same type
      job = jobs.find(j => {
        if (j.runId !== currentRunId) return false;
        const jobSubtype = j.payload?.jobType || j.metadata?.jobType;
        if (stepId === "ad-collection") return jobSubtype === "ad_raw_collection";
        if (stepId === "ad-transcripts") return jobSubtype === "ad_transcripts";
        return false;
      });
    } else {
      job = jobs.find(j => j.type === jobType && j.runId === currentRunId);
    }
    
    if (!job) {
      return { status: "NOT_STARTED" };
    }
    
    console.log(`[Step Status] ${stepId}:`, {
      jobType,
      currentRunId,
      jobId: job.id,
      jobStatus: job.status,
      jobRunId: job.runId
    });
    
    return {
      status: job.status,
      lastJob: job,
    };
  };

  // Update step statuses based on jobs
  const updatedTracks = tracks.map((track) => ({
    ...track,
    steps: track.steps.map((step) => {
      const { status, lastJob } = getStepStatus(step.jobType, step.id);
      
      return {
        ...step,
        status,
        lastJob,
      };
    }),
  }));

  // Calculate completion percentage
  const calculateCompletion = (track: ResearchTrack): number => {
    const completed = track.steps.filter((s) => s.status === "COMPLETED").length;
    return Math.round((completed / track.steps.length) * 100);
  };

  // Get unique runs
  const runs = Array.from(new Set(jobs.map(j => j.runId).filter(Boolean)));

  // Get run status based on jobs with specific runId
  const getRunStatus = (runId: string) => {
    const runJobs = jobs.filter(j => j.runId === runId);
    if (runJobs.length === 0) return 'NOT_STARTED';
    
    const hasRunning = runJobs.some(j => j.status === 'RUNNING');
    const hasFailed = runJobs.some(j => j.status === 'FAILED');
    const allCompleted = runJobs.every(j => j.status === 'COMPLETED');
    
    if (hasRunning) return 'IN_PROGRESS';
    if (hasFailed) return 'FAILED';
    if (allCompleted) return 'COMPLETED';
    return 'IN_PROGRESS';
  };


  // Calculate elapsed time for running jobs
  const getElapsedTime = (createdAt: string) => {
    const start = new Date(createdAt).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - start) / 1000);
    
    if (elapsed < 60) return `${elapsed}s`;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  const getRowsCollected = (summary: Job["resultSummary"]) => {
    if (!summary) return undefined;
    if (typeof summary === "object" && "rowsCollected" in summary) {
      const value = (summary as any).rowsCollected;
      return typeof value === "number" ? value : undefined;
    }
    if (typeof summary === "string") {
      const match = summary.match(/(\d+)\s+rows/i);
      return match ? Number(match[1]) : undefined;
    }
    return undefined;
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
      setActiveStepModal(step.id);
      return;
    } else if (step.id === "ad-collection") {
      setPendingStep({ step, trackKey });
      setActiveStepModal(step.id);
      return;
    } else if (step.id === "product-collection") {
      setPendingStep({ step, trackKey });
      setActiveStepModal(step.id);
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
      // Reddit search parameters
      redditKeywords: formData.redditKeywords.split(',').map(k => k.trim()).filter(Boolean),
      ...(formData.redditSubreddits && { redditSubreddits: formData.redditSubreddits.split(',').map(s => s.trim()).filter(Boolean) }),
      maxPosts: formData.maxPosts,
      maxCommentsPerPost: formData.maxCommentsPerPost,
      timeRange: formData.timeRange,
      scrapeComments: formData.scrapeComments,
    };

    setActiveStepModal(null);
    await executeStep(pendingStep.step, payload);
    setPendingStep(null);
  };

  const handleAdCollectionSubmit = async (formData: AdCollectionFormData) => {
    if (!pendingStep) return;
    
    setActiveStepModal(null);
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

    setActiveStepModal(null);
    await executeStep(pendingStep.step, payload);
    setPendingStep(null);
  };

  const handleStartNewRun = () => {
    setCurrentRunId(null);
    setShowNewRunModal(false);
    toast.success("New research run started!");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRunAllResearch = async (formData: RunAllResearchFormData) => {
    setShowRunAllModal(false);
    
    const runId = crypto.randomUUID();
    setCurrentRunId(runId);
    
    toast.success("Starting all research jobs...");
    
    try {
      // Start Customer Research
      const customerResearchPayload = {
        projectId,
        runId,
        productName: formData.productName,
        productProblemSolved: formData.productProblemSolved,
        productAmazonAsin: formData.productAmazonAsin,
        ...(formData.competitor1Asin && { competitor1Asin: formData.competitor1Asin }),
        ...(formData.competitor2Asin && { competitor2Asin: formData.competitor2Asin }),
      };
      
      await fetch('/api/jobs/customer-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerResearchPayload),
      });
      
      // Start Ad Collection
      const adCollectionPayload = {
        projectId,
        runId,
        industryCode: formData.industryCode,
      };
      
      await fetch('/api/jobs/ad-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adCollectionPayload),
      });
      
      // Start Product Data Collection
      const productCollectionPayload = {
        projectId,
        runId,
        productName: formData.productName,
        productUrl: formData.productUrl,
        competitorUrls: formData.competitorUrls.filter(url => url.trim() !== ''),
      };
      
      await fetch('/api/jobs/product-data-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productCollectionPayload),
      });
      
      await loadJobs();
      toast.success("All research jobs started successfully!");
    } catch (error: any) {
      console.error("Failed to start research jobs:", error);
      toast.error(error.message || "Failed to start some research jobs");
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
    <>
      {/* Run All Research Modal */}
      {showRunAllModal && (
        <RunAllResearchModal
          onSubmit={handleRunAllResearch}
          onClose={() => setShowRunAllModal(false)}
        />
      )}


      {/* New Run Confirmation Modal */}
      {showNewRunModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-md w-full">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-2">Start New Research Run?</h2>
              <p className="text-sm text-slate-400 mb-6">
                This will begin tracking a fresh set of research jobs. Your previous run data will remain accessible in the job history.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowNewRunModal(false)}
                  className="flex-1 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartNewRun}
                  className="flex-1 px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-medium"
                >
                  Start New Run
                </button>
              </div>
            </div>
          </div>
        </div>
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
        </div>
      </div>

      {/* Current Run Banner */}
      <div className="mb-6 p-4 rounded-lg bg-slate-900/50 border border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-2">Current Research Run</p>
            <select
              value={currentRunId || ''}
              onChange={(e) => setCurrentRunId(e.target.value || null)}
              className='px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500'
            >
              <option value=''>No active run</option>
              {runs.map(runId => {
                if (!runId) return null;
                const runJobs = jobs.filter(j => j.runId === runId);
                const firstJob = runJobs[0];
                if (!firstJob) return null;
                
                const date = new Date(firstJob.createdAt);
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                
                let label;
                if (date.toDateString() === today.toDateString()) {
                  label = `Today - ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                } else if (date.toDateString() === yesterday.toDateString()) {
                  label = `Yesterday - ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                } else {
                  label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                }
                
                return (
                  <option key={runId} value={runId}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
          <button
            onClick={() => setShowRunAllModal(true)}
            className='px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg'
          >
            Run All Research
          </button>
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
              <div className="mb-4">
                <h2 className="text-xl font-bold text-white">{track.label}</h2>
                <p className="text-sm text-slate-400">{track.description}</p>
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
                    const rowsCollected =
                      step.jobType === "CUSTOMER_RESEARCH"
                        ? getRowsCollected(step.lastJob?.resultSummary)
                        : undefined;

                    return (
                      <div
                        key={step.id}
                        className="flex items-start gap-4 p-4 rounded-lg bg-slate-900/50 border border-slate-800"
                      >
                        {/* Step Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white mb-1">
                            {step.label}
                          </h3>
                          <p className="text-xs text-slate-400 mb-2">{step.description}</p>
                          {step.status !== "NOT_STARTED" && <StatusBadge status={step.status} />}

                          {/* Success Celebration */}
                          {step.status === "COMPLETED" && step.lastJob && recentlyCompleted.has(step.lastJob.id) && (
                            <div className="mt-2 flex items-center gap-2 text-emerald-400 animate-bounce">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-sm font-medium">Just completed!</span>
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
                        <div className="flex-shrink-0 flex gap-2">
                          {step.status === "COMPLETED" && step.lastJob && (
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => router.push(`/projects/${projectId}/research-hub/results/${step.lastJob!.id}`)}
                                className="text-sky-400 hover:text-sky-300 text-xs underline"
                              >
                                View Results
                              </button>
                              {step.jobType === "CUSTOMER_RESEARCH" && (
                                <Link
                                  href={`/projects/${projectId}/research/data/${step.lastJob!.id}`}
                                  className="text-sky-400 hover:text-sky-300 text-xs underline"
                                >
                                  {typeof rowsCollected === "number"
                                    ? `View Raw Data (${rowsCollected} rows)`
                                    : "View Raw Data"}
                                </Link>
                              )}
                              <button
                                onClick={() => {
                                  const url = currentRunId 
                                    ? `/projects/${projectId}/research-hub/jobs/${step.jobType}?runId=${currentRunId}`
                                    : `/projects/${projectId}/research-hub/jobs/${step.jobType}`;
                                  router.push(url);
                                }}
                                className="text-slate-400 hover:text-slate-300 text-xs underline"
                              >
                                {currentRunId ? 'View Run History' : 'View All History'}
                              </button>
                            </div>
                          )}
                          {step.status === "COMPLETED" ? (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={isRunning}
                              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2"
                            >
                              Re-run
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => runStep(step, track.key)}
                                disabled={locked || isRunning}
                                className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 ${
                                  locked || isRunning
                                    ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                                    : `bg-${track.color}-500 hover:bg-${track.color}-400 text-white`
                                }`}
                              >
                                {isRunning ? "Starting..." : locked ? "🔒 Locked" : "Run"}
                              </button>
                              {/* Upload button for collection steps */}
                              {(step.jobType === 'CUSTOMER_RESEARCH' || 
                                step.jobType === 'AD_PERFORMANCE' || 
                                step.jobType === 'PRODUCT_DATA_COLLECTION') && 
                                step.status === 'NOT_STARTED' && !locked && (
                                <button
                                  onClick={() => setShowUploadModal(step.jobType)}
                                  className="px-4 py-2 rounded text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300"
                                >
                                  📤 Upload
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {/* Step Modal - Render inline */}
                        {activeStepModal === step.id && (
                          <>
                            {step.id === "customer-research" && (
                              <CustomerResearchModal
                                onSubmit={handleCustomerResearchSubmit}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                }}
                              />
                            )}
                            {step.id === "ad-collection" && (
                              <AdCollectionModal
                                onSubmit={handleAdCollectionSubmit}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                }}
                              />
                            )}
                            {step.id === "product-collection" && (
                              <ProductCollectionModal
                                onSubmit={handleProductCollectionSubmit}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                }}
                              />
                            )}
                          </>
                        )}

                        {/* Upload Modal - Render inline */}
                        {showUploadModal === step.jobType && (
                          <div className='mt-4 p-4 bg-slate-900 border border-slate-700 rounded-lg'>
                            <UploadDataModal
                              jobType={step.jobType}
                              projectId={projectId}
                              currentRunId={currentRunId}
                              onSuccess={() => {
                                setShowUploadModal(null);
                                loadJobs();
                                toast.success('Data uploaded successfully!');
                              }}
                              onClose={() => setShowUploadModal(null)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
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

      {/* Next Step CTA */}
      <div className="mt-8 p-6 rounded-lg bg-slate-900/50 border border-slate-800">
        <h3 className="text-lg font-bold text-white mb-2">Ready for Production?</h3>
        <p className="text-sm text-slate-400 mb-4">
          Once you've completed your research, head to the Creative Studio to generate
          ad scripts and videos.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/projects/${projectId}/creative-studio`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium"
          >
            Go to Creative Studio →
          </Link>
          <Link
            href={`/projects/${projectId}/usage`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
          >
            View Usage & Costs →
          </Link>
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
    redditKeywords: "",
    redditSubreddits: "",
    maxPosts: 50,
    maxCommentsPerPost: 50,
    timeRange: 'month',
    scrapeComments: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productName || !formData.productProblemSolved) {
      alert("Please fill in all required fields");
      return;
    }
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Product & Competitor Details</h2>
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
                Amazon ASIN <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.productAmazonAsin}
                onChange={(e) => setFormData({ ...formData, productAmazonAsin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., B07XYZ1234"
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

            {/* Reddit Search Settings */}
            <div className="border-t border-slate-700 pt-4 mt-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Reddit Search Settings</h3>
              <p className="text-xs text-slate-400 mb-4">
                Product name and problem will automatically be searched on Reddit. Add extra keywords below if needed.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Additional Reddit Keywords <span className="text-slate-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.redditKeywords}
                    onChange={(e) => setFormData({ ...formData, redditKeywords: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="noise cancelling, ANC, battery life"
                  />
                  <p className="text-xs text-slate-500 mt-1">Optional - Add extra keywords beyond product name and problem</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Target Subreddits <span className="text-slate-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.redditSubreddits || ''}
                    onChange={(e) => setFormData({ ...formData, redditSubreddits: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="headphones, audiophile, BuyItForLife"
                  />
                  <p className="text-xs text-slate-500 mt-1">Leave empty to search all subreddits</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Time Range
                  </label>
                  <select
                    value={formData.timeRange}
                    onChange={(e) => setFormData({ ...formData, timeRange: e.target.value as 'week' | 'month' | 'year' | 'all' })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="week">Past Week</option>
                    <option value="month">Past Month</option>
                    <option value="year">Past Year</option>
                    <option value="all">All Time</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.scrapeComments}
                      onChange={(e) => setFormData({ ...formData, scrapeComments: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-slate-300">Scrape comments from posts</span>
                  </label>
                  <p className="text-xs text-slate-500 mt-1 ml-6">Recommended for deeper insights</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Max Posts
                    </label>
                    <input
                      type="number"
                      name="maxPosts"
                      value={formData.maxPosts}
                      min={10}
                      max={1000}
                      onChange={(e) => setFormData({ ...formData, maxPosts: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200"
                    />
                    <p className="text-xs text-slate-500 mt-1">Recommended: 50-200</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Max Comments Per Post
                    </label>
                    <input
                      type="number"
                      name="maxCommentsPerPost"
                      value={formData.maxCommentsPerPost}
                      min={0}
                      max={500}
                      onChange={(e) => setFormData({ ...formData, maxCommentsPerPost: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200"
                    />
                    <p className="text-xs text-slate-500 mt-1">0 = no comments, Recommended: 50-100</p>
                  </div>
                </div>
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
          <h2 className="text-xl font-bold text-white mb-2">Industry Selection</h2>
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
          <h2 className="text-xl font-bold text-white mb-2">Product Information</h2>
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

// Upload Data Modal Component
function UploadDataModal({
  jobType,
  projectId,
  currentRunId,
  onSuccess,
  onClose,
}: {
  jobType: JobType;
  projectId: string;
  currentRunId: string | null;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const schemas = {
    CUSTOMER_RESEARCH: {
      type: 'csv',
      required: ['source', 'text', 'rating', 'author'],
      example: 'source,text,rating,author\nreddit,Great product,5,user123'
    },
    AD_PERFORMANCE: {
      type: 'csv',
      required: ['adId', 'platform', 'transcript', 'views'],
      example: 'adId,platform,transcript,views\n001,facebook,Buy now,10000'
    },
    PRODUCT_DATA_COLLECTION: {
      type: 'json',
      required: ['productName', 'features', 'competitors'],
      example: '{"productName":"X","features":[],"competitors":[]}'
    }
  };

  const schema = schemas[jobType as keyof typeof schemas];

  const parseCSV = (text: string): any[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const obj: any = {};
      headers.forEach((header, i) => {
        obj[header] = values[i] || '';
      });
      return obj;
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setPreview(null);

    try {
      const text = await selectedFile.text();
      let data: any;

      if (schema.type === 'csv') {
        data = parseCSV(text);
      } else {
        data = JSON.parse(text);
      }

      // Validate format
      const validation = validateFormat(data);
      if (!validation.valid) {
        setError(validation.error!);
        return;
      }

      setPreview(data);
    } catch (err: any) {
      setError(`Failed to parse file: ${err.message}`);
    }
  };

  const validateFormat = (data: any): { valid: boolean; error?: string } => {
    if (schema.type === 'csv') {
      if (!Array.isArray(data)) {
        return { valid: false, error: 'Must be CSV format' };
      }
      if (data.length === 0) {
        return { valid: false, error: 'File is empty' };
      }
      
      const columns = Object.keys(data[0] || {});
      const missing = schema.required.filter(col => !columns.includes(col));
      
      if (missing.length > 0) {
        return {
          valid: false,
          error: `Missing columns: ${missing.join(', ')}. Expected: ${schema.required.join(', ')}`
        };
      }
    }

    if (schema.type === 'json') {
      const missing = schema.required.filter(key => !(key in data));
      if (missing.length > 0) {
        return {
          valid: false,
          error: `Missing fields: ${missing.join(', ')}`
        };
      }
    }

    return { valid: true };
  };

  const handleUpload = async () => {
    if (!preview) return;

    setUploading(true);
    setError(null);

    try {
      const response = await fetch('/api/jobs/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          runId: currentRunId,
          jobType,
          data: preview,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([schema.example], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${jobType.toLowerCase()}.${schema.type === 'csv' ? 'csv' : 'json'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Upload Data</h2>
          <p className="text-sm text-slate-400 mb-6">
            Upload your {jobType.replace(/_/g, ' ').toLowerCase()} data
          </p>

          {/* Format Help */}
          <div className="mb-6 p-4 rounded-lg bg-slate-800 border border-slate-700">
            <h3 className="text-sm font-semibold text-white mb-2">Expected Format</h3>
            <p className="text-xs text-slate-400 mb-2">
              File type: <span className="text-white font-mono">{schema.type.toUpperCase()}</span>
            </p>
            <p className="text-xs text-slate-400 mb-2">
              Required fields: <span className="text-white font-mono">{schema.required.join(', ')}</span>
            </p>
            <button
              onClick={downloadTemplate}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              Download template file
            </button>
          </div>

          {/* File Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Select File
            </label>
            <input
              type="file"
              accept={schema.type === 'csv' ? '.csv' : '.json'}
              onChange={handleFileSelect}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-sky-600 file:text-white hover:file:bg-sky-500"
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Preview */}
          {preview && !error && (
            <div className="mb-6 p-4 rounded-lg bg-slate-800 border border-slate-700">
              <h3 className="text-sm font-semibold text-white mb-2">Preview</h3>
              <div className="text-xs text-slate-400 font-mono max-h-40 overflow-auto">
                {Array.isArray(preview) ? (
                  <div>
                    <p className="text-emerald-400 mb-2">✓ {preview.length} rows found</p>
                    <pre>{JSON.stringify(preview.slice(0, 3), null, 2)}</pre>
                    {preview.length > 3 && <p className="mt-2">... and {preview.length - 3} more rows</p>}
                  </div>
                ) : (
                  <pre>{JSON.stringify(preview, null, 2)}</pre>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={uploading}
              className="flex-1 px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={!preview || uploading || !!error}
              className="flex-1 px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {uploading && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
              )}
              {uploading ? 'Uploading...' : 'Upload Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Run All Research Modal Component
function RunAllResearchModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: RunAllResearchFormData) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<RunAllResearchFormData>({
    productName: "",
    productProblemSolved: "",
    productAmazonAsin: "",
    competitor1Asin: "",
    competitor2Asin: "",
    industryCode: "",
    productUrl: "",
    competitorUrls: [""],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productName || !formData.productProblemSolved || !formData.productAmazonAsin || !formData.industryCode || !formData.productUrl) {
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
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Run All Research</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter all details to start customer, ad, and product research simultaneously
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Customer Research Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-emerald-400 mb-3">Customer Research</h3>
              <div className="space-y-4">
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
                    rows={2}
                    required
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Amazon ASIN <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.productAmazonAsin}
                      onChange={(e) => setFormData({ ...formData, productAmazonAsin: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="B07XYZ1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Competitor 1 ASIN
                    </label>
                    <input
                      type="text"
                      value={formData.competitor1Asin}
                      onChange={(e) => setFormData({ ...formData, competitor1Asin: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="B08ABC5678"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Competitor 2 ASIN
                    </label>
                    <input
                      type="text"
                      value={formData.competitor2Asin}
                      onChange={(e) => setFormData({ ...formData, competitor2Asin: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="B09DEF9012"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Ad Research Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-sky-400 mb-3">Ad Research</h3>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Industry Code <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.industryCode}
                  onChange={(e) => setFormData({ ...formData, industryCode: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="e.g., tech, fitness, beauty"
                  required
                />
              </div>
            </div>

            {/* Product Research Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-violet-400 mb-3">Product Research</h3>
              <div className="space-y-4">
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
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-700">
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
                Start All Research
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
