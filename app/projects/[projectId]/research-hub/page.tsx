"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast, { Toaster } from "react-hot-toast";
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
  maxPosts: number;
  maxCommentsPerPost: number;
  timeRange: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
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
  const searchParams = useSearchParams();
  const selectedProductFromUrl = searchParams.get('product');
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previousJobs, setPreviousJobs] = useState<Job[]>([]);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<string | null>(selectedProductFromUrl);
  const [products, setProducts] = useState<string[]>([]);
  const [pauseAutoRefresh, setPauseAutoRefresh] = useState(false);
  const [customerModalTab, setCustomerModalTab] = useState<"scrape" | "upload">("scrape");
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadOnly, setUploadOnly] = useState(false);
  const selectedProductRef = useRef<string | null>(selectedProduct);
  const hasInitializedProductsRef = useRef(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Modal states
  const [activeStepModal, setActiveStepModal] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<{ step: ResearchStep; trackKey: string } | null>(null);
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);

  useEffect(() => {
    selectedProductRef.current = selectedProduct;
  }, [selectedProduct]);

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

  const selectedRun = selectedRunId ? sortedRuns.find((run) => run.runId === selectedRunId) : null;

  const selectedRunCustomerJob = selectedRun
    ? selectedRun.jobs
        .filter((j) => j.type === "CUSTOMER_RESEARCH" && j.status === "COMPLETED")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;

  const getStatusIcon = (status: JobStatus) => {
    const icons: Record<JobStatus, string> = {
      COMPLETED: "✓",
      FAILED: "✕",
      RUNNING: "⏳",
      PENDING: "○",
      NOT_STARTED: "○",
    };
    return icons[status] || "";
  };

  const getLastJobStatus = (runJobs: Job[]) => {
    const sorted = [...runJobs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const lastJob = sorted.find((j) => j.status !== "PENDING");
    if (!lastJob) return "Not started";
    return `${getJobTypeLabel(lastJob.type)} ${getStatusIcon(lastJob.status)}`;
  };

  const formatRunDate = (dateString: string) =>
    new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  const loadJobs = useCallback(async (forceProduct?: string) => {
    console.log('[loadJobs] Starting job fetch...', { projectId, forceProduct, timestamp: new Date().toISOString() });
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs`);
      const data = await response.json();

      console.log('[loadJobs] Fetched jobs:', { 
        success: data.success, 
        jobCount: data.jobs?.length,
        jobs: data.jobs 
      });

      if (!data.success) {
        throw new Error('Failed to load jobs');
      }

      const uniqueProducts = [...new Set(
        data.jobs
          .map((j: any) => j.payload?.productName)
          .filter(Boolean)
      )] as string[];

      setProducts(uniqueProducts);

      let productToFilter = (forceProduct ?? selectedProductRef.current) || null;

      if (!productToFilter && uniqueProducts.length > 0 && !hasInitializedProductsRef.current) {
        productToFilter = uniqueProducts[0];
        setSelectedProduct(productToFilter);
      }

      hasInitializedProductsRef.current = true;

      const filteredJobs = productToFilter
        ? data.jobs.filter((j: any) => j.payload?.productName === productToFilter)
        : data.jobs;

      setJobs((prevJobs) => {
        setPreviousJobs(prevJobs);
        return filteredJobs || [];
      });
      console.log('[loadJobs] Jobs filtered:', { product: productToFilter, filteredCount: filteredJobs.length });
    } catch (error) {
      console.error('[loadJobs] Error:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load jobs on mount
  useEffect(() => {
    if (projectId) {
      loadJobs();
    }
  }, [loadJobs, projectId]);

  // Auto-refresh jobs every 5 seconds only while jobs are running
  useEffect(() => {
    if (!projectId || pauseAutoRefresh) return;
    const hasRunningJob = jobs.some((j) => j.status === "RUNNING");
    if (!hasRunningJob) return;

    const interval = setInterval(() => {
      loadJobs();
    }, 5000);

    return () => clearInterval(interval);
  }, [jobs, loadJobs, pauseAutoRefresh, projectId]);

  // Detect job completions and show celebration
  useEffect(() => {
    if (previousJobs.length === 0) return;

    const newCompletions = jobs.filter(job => 
      job.status === 'COMPLETED' && 
      previousJobs.find(prev => prev.id === job.id && prev.status === 'RUNNING')
    );
    
    newCompletions.forEach(job => {
      setRecentlyCompleted(prev => new Set(prev).add(job.id));
      toast.success(`${getJobTypeLabel(job.type)} completed!`, {
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
          label: "Customer Collection",
          description: "Gather Reddit discussions and Amazon reviews",
          jobType: "CUSTOMER_RESEARCH",
          endpoint: "/api/jobs/customer-research",
          status: "NOT_STARTED",
        },
        {
          id: "customer-analysis",
          label: "Customer Analysis",
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
      label: "Ad Collection",
      description: "Analyze successful ad patterns",
      color: "sky",
      enabled: true,
      steps: [
        {
          id: "ad-collection",
          label: "Ad Collection",
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
          label: "Ad Analysis",
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
      label: "Product Collection",
      description: "Deep dive into your product features",
      color: "violet",
      enabled: true,
      steps: [
        {
          id: "product-collection",
          label: "Product Collection",
          description: "Gather product information and features",
          jobType: "PRODUCT_DATA_COLLECTION",
          endpoint: "/api/jobs/product-data-collection",
          status: "NOT_STARTED",
        },
        {
          id: "product-analysis",
          label: "Product Analysis",
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

  const latestCompletedCustomerResearchJob = jobs
    .filter((job) => job.type === "CUSTOMER_RESEARCH" && job.status === "COMPLETED")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

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

  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const latestJob = jobs.length
    ? jobs.reduce((latest, job) =>
        new Date(job.createdAt).getTime() > new Date(latest.createdAt).getTime() ? job : latest
      )
    : null;

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
      setCustomerModalTab("scrape");
      setUploadJobId(null);
      setUploadOnly(false);
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

  const cancelJob = async (jobId: string) => {
    if (!confirm("Are you sure you want to cancel this job?")) return;

    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
      });

      if (response.ok) {
        toast.success("Job cancelled");
        loadJobs();
        return;
      }

      const data = await response.json().catch(() => ({}));
      toast.error(data?.error || "Failed to cancel job");
    } catch (error) {
      toast.error("Error cancelling job");
    }
  };

  // Handle modal submissions
  const handleCustomerResearchSubmit = async (formData: CustomerResearchFormData) => {
    if (!pendingStep) return;
    
    const payload = {
      productName: formData.productName,
      productProblemSolved: formData.productProblemSolved,
      productAmazonAsin: formData.productAmazonAsin,
      ...(formData.competitor1Asin && { competitor1AmazonAsin: formData.competitor1Asin }),
      ...(formData.competitor2Asin && { competitor2AmazonAsin: formData.competitor2Asin }),
      // Reddit search parameters
      redditKeywords: formData.redditKeywords.split(',').map(k => k.trim()).filter(Boolean),
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
        ...(formData.competitor1Asin && { competitor1AmazonAsin: formData.competitor1Asin }),
        ...(formData.competitor2Asin && { competitor2AmazonAsin: formData.competitor2Asin }),
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
            <h1 className="text-3xl font-bold text-white mb-2">
              Research Hub{selectedProduct ? ` - ${selectedProduct}` : ""}
            </h1>
            <div className="flex items-center gap-3">
              <p className="text-slate-400">
                Build a comprehensive understanding of your customers, ads, and product
              </p>
              {latestJob ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>Last run: {formatDateTime(latestJob.createdAt)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>No runs yet</span>
                </div>
              )}
            </div>
          </div>
          {selectedProduct && (
            <Link
              href={`/projects/${projectId}/research/data?product=${selectedProduct}`}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-slate-200"
            >
              View All Data
            </Link>
          )}
        </div>
      </div>

      {/* Current Run Banner */}
      <div className="mb-6 p-4 rounded-lg bg-slate-900/50 border border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-2">Current Research Run</p>
            {products.length > 0 ? (
              <div className="flex items-center gap-3 mb-3">
                <label className="text-sm text-slate-400">Product:</label>
                <select
                  value={selectedProduct || ''}
                  onChange={(e) => {
                    const newProduct = e.target.value;
                    setPauseAutoRefresh(true);
                    setSelectedProduct(newProduct);
                    const url = new URL(window.location.href);
                    url.searchParams.set('product', newProduct);
                    router.replace(url.pathname + url.search, { scroll: false });
                    loadJobs(newProduct);
                    setTimeout(() => setPauseAutoRefresh(false), 10000);
                  }}
                  className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-sm min-w-[200px]"
                >
                  {products.map(product => (
                    <option key={product} value={product}>
                      {product}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-slate-400 mb-3">No product research runs yet</p>
            )}
            <select
              value={selectedRunId || "no-active"}
              onChange={(e) => {
                const value = e.target.value === "no-active" ? null : e.target.value;
                setSelectedRunId(value);
                setCurrentRunId(value);
              }}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="no-active">No active run</option>
              {sortedRuns.map((run) => (
                <option key={run.runId} value={run.runId}>
                  Run #{run.runNumber} - Last: {getLastJobStatus(run.jobs)} - {formatRunDate(run.createdAt)}
                </option>
              ))}
            </select>
            {selectedRun && (
              <div className="mt-3 text-sm text-slate-400">
                <div className="mt-2 text-slate-400">Jobs in this run:</div>
                <div className="mt-2 space-y-1">
                  {selectedRun.jobs
                    .slice()
                    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                    .map((job) => {
                      const statusIcon =
                        job.status === "COMPLETED"
                          ? "✓"
                          : job.status === "FAILED"
                            ? "✕"
                            : job.status === "RUNNING"
                              ? "●"
                              : "○";
                      return (
                        <div key={job.id} className="flex items-center gap-2">
                          <span className="text-slate-300">{statusIcon}</span>
                          <span>{getJobTypeLabel(job.type)}</span>
                          <span className="text-xs text-slate-500">
                            {job.status === "COMPLETED"
                              ? new Date(job.createdAt).toLocaleTimeString("en-US", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : job.status.toLowerCase()}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
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
                    const customerResearchJob = step.jobType === "CUSTOMER_RESEARCH"
                      ? latestCompletedCustomerResearchJob
                      : undefined;
                    const rowsCollected =
                      step.jobType === "CUSTOMER_RESEARCH"
                        ? getRowsCollected(customerResearchJob?.resultSummary)
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
                          {step.jobType === "CUSTOMER_RESEARCH" ? (
                            customerResearchJob && (
                            <div className="flex flex-col gap-1">
                              <>
                                {selectedRunCustomerJob ? (
                                  <Link
                                    href={`/projects/${projectId}/research/data/${selectedRunCustomerJob.id}?runId=${selectedRun.runId}`}
                                    className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
                                  >
                                    View Raw Data
                                  </Link>
                                ) : (
                                  <button
                                    disabled
                                    className="px-4 py-2 bg-gray-600 text-gray-400 rounded opacity-50 cursor-not-allowed text-xs"
                                    title={!selectedRun ? "Select a run first" : "Customer Collection must be completed"}
                                  >
                                    View Raw Data
                                  </button>
                                )}
                              </>
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
                            )
                          ) : (
                          step.status === "COMPLETED" && step.lastJob && (
                            <div className="flex flex-col gap-1">
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
                          ))}
                          {step.status === "COMPLETED" ? (
                            <button
                              onClick={() => runStep(step, track.key)}
                              disabled={isRunning}
                              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm flex items-center gap-2"
                            >
                              {step.jobType === "CUSTOMER_RESEARCH" ? "Collect Data" : "Re-run"}
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
                                {isRunning
                                  ? "Starting..."
                                  : locked
                                    ? "🔒 Locked"
                                    : step.jobType === "CUSTOMER_RESEARCH"
                                      ? "Collect Data"
                                      : "Run"}
                              </button>
                            </>
                          )}
                          {step.status === "RUNNING" && step.lastJob && (
                            <button
                              onClick={() => cancelJob(step.lastJob!.id)}
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                            >
                              Cancel
                            </button>
                          )}
                        </div>

                        {/* Step Modal - Render inline */}
                        {activeStepModal === step.id && (
                          <>
                            {step.id === "customer-research" && (
                              <CustomerResearchModal
                                onSubmit={handleCustomerResearchSubmit}
                                projectId={projectId}
                                uploadJobId={uploadJobId}
                                initialTab={customerModalTab}
                                uploadOnly={uploadOnly}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                  setUploadJobId(null);
                                  setCustomerModalTab("scrape");
                                  setUploadOnly(false);
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
          {jobs.slice(0, 10).map(job => {
            const rs = job.resultSummary as any;
            return (
              <div key={job.id} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-200">{job.type}</div>
                  <div className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()}</div>
                  {rs?.amazon && (
                    <div className="mt-2 rounded border border-slate-800 p-2 text-sm text-slate-300">
                      <div className="font-medium text-slate-200">Amazon</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                        <div>Product total</div><div className="text-right">{rs.amazon.productTotal ?? 0}</div>
                        <div>4★ total</div><div className="text-right">{rs.amazon.product4Star ?? 0}</div>
                        <div>5★ total</div><div className="text-right">{rs.amazon.product5Star ?? 0}</div>
                        <div>Stored from 4★</div><div className="text-right">{rs.amazon.storedFrom4Star ?? 0}</div>
                        <div>Stored from 5★</div><div className="text-right">{rs.amazon.storedFrom5Star ?? 0}</div>
                        <div>Competitor 1 total</div><div className="text-right">{rs.amazon.competitor1Total ?? 0}</div>
                        <div>Competitor 2 total</div><div className="text-right">{rs.amazon.competitor2Total ?? 0}</div>
                      </div>
                    </div>
                  )}
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
            );
          })}
        </div>
      </div>

      {/* Next Step CTA */}
      <div className="mt-8 p-6 rounded-lg bg-slate-900/50 border border-slate-800">
        <h3 className="text-lg font-bold text-white mb-2">Ready for Production?</h3>
        <p className="text-sm text-slate-400 mb-4">
          Once you&apos;ve completed your research, head to the Creative Studio to generate
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
  initialTab = "scrape",
  projectId,
  uploadJobId,
  uploadOnly = false,
}: {
  onSubmit: (data: CustomerResearchFormData) => void;
  onClose: () => void;
  initialTab?: "scrape" | "upload";
  projectId: string;
  uploadJobId: string | null;
  uploadOnly?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"scrape" | "upload">(initialTab);
  const [formData, setFormData] = useState<CustomerResearchFormData>({
    productName: "",
    productProblemSolved: "",
    productAmazonAsin: "",
    competitor1Asin: "",
    competitor2Asin: "",
    redditKeywords: "",
    maxPosts: 50,
    maxCommentsPerPost: 50,
    timeRange: 'month',
    scrapeComments: true,
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
    setUploadFile(null);
    setUploading(false);
  }, [initialTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasAmazonAsin = formData.productAmazonAsin?.trim();
    const hasRedditData = formData.productName?.trim() || formData.productProblemSolved?.trim();

    if (!hasAmazonAsin && !hasRedditData) {
      alert("Please provide either an Amazon ASIN or Product Name/Problem for Reddit scraping");
      return;
    }

    if (hasRedditData && (!formData.productName || !formData.productProblemSolved)) {
      alert("Product Name and Problem are required for Reddit scraping");
      return;
    }
    onSubmit(formData);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error("Please select a file");
      return;
    }
    if (!uploadJobId) {
      toast.error("Missing job reference for upload");
      return;
    }

    setUploading(true);
    const formDataUpload = new FormData();
    formDataUpload.append("file", uploadFile);
    formDataUpload.append("jobId", uploadJobId);
    formDataUpload.append("projectId", projectId);

    try {
      const response = await fetch(`/api/projects/${projectId}/research/upload`, {
        method: "POST",
        body: formDataUpload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }
      toast.success(`Added ${data.rowsAdded} rows from uploaded file`);
      router.refresh();
      onClose();
    } catch (error: any) {
      toast.error(error.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">
            {uploadOnly ? "Upload Research Data" : "Collect Customer Inputs"}
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            {uploadOnly
              ? "Add additional research data to your existing collection"
              : "Scrape from Reddit/Amazon or upload your own research data"}
          </p>

          {!uploadOnly && (
            <div className="flex gap-2 mb-6 border-b border-slate-700">
              <button
                type="button"
                onClick={() => setActiveTab("scrape")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "scrape"
                    ? "border-sky-500 text-sky-400"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                Scrape Data
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("upload")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "upload"
                    ? "border-sky-500 text-sky-400"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                Upload Data
              </button>
            </div>
          )}

          {!uploadOnly && activeTab === "scrape" && (
            <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product Name <span className="text-slate-500">(required for Reddit)</span>
              </label>
              <input
                type="text"
                value={formData.productName}
                onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., Wireless Headphones"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Product Problem Solved <span className="text-slate-500">(required for Reddit)</span>
              </label>
              <textarea
                value={formData.productProblemSolved}
                onChange={(e) => setFormData({ ...formData, productProblemSolved: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., Provides noise cancellation for focus"
                rows={3}
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
                    Time Range
                  </label>
                  <select
                    value={formData.timeRange}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        timeRange: e.target.value as 'hour' | 'day' | 'week' | 'month' | 'year' | 'all',
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="hour">Past Hour</option>
                    <option value="day">Past Day</option>
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
          )}

          {(uploadOnly || activeTab === "upload") && (
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Upload Research File
                </label>
                <p className="text-xs text-slate-400 mb-3">
                  Accepted formats: CSV, TXT, PDF, DOCX, JSON
                </p>
                <input
                  type="file"
                  accept=".csv,.txt,.pdf,.docx,.json"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded file:border-0
                    file:text-sm file:font-medium
                    file:bg-sky-600 file:text-white
                    hover:file:bg-sky-500"
                />
                {uploadFile && (
                  <p className="text-xs text-slate-400 mt-2">
                    Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                >
                  {uploading ? "Uploading..." : "Upload & Add Data"}
                </button>
              </div>
              {uploading && (
                <p className="text-xs text-slate-400 text-right">Processing file...</p>
              )}
            </form>
          )}
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
            {/* Customer Collection Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-emerald-400 mb-3">Customer Collection</h3>
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

            {/* Ad Collection Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-sky-400 mb-3">Ad Collection</h3>
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

            {/* Product Collection Section */}
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-violet-400 mb-3">Product Collection</h3>
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
