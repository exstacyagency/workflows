"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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

interface ProductOption {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
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
  productProblemSolved: string;
  additionalProblems: string;
  mainProductAsin: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
  competitor3Asin?: string;
  // Reddit search parameters
  searchIntent: string;
  solutionKeywords: string;
  maxPosts: number;
  maxCommentsPerPost: number;
  timeRange: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  scrapeComments: boolean;
}

interface AdCollectionFormData {
  industryCode: string;
}

interface ProductCollectionFormData {
  productUrl: string;
  returnsUrl: string;
  shippingUrl: string;
  aboutUrl: string;
}

interface AdDataCompleteness {
  totalAds: number;
  withTranscript: number;
  withOcr: number;
  withKeyframe: number;
  withAllData: number;
  transcriptCoverage: number;
  ocrCoverage: number;
  keyframeCoverage: number;
  minAdsRequired: number;
  minTranscriptCoverage: number;
  minOcrCoverage: number;
  minCompleteAds: number;
  canRun: boolean;
  reason: string | null;
}

interface RunAllResearchFormData {
  productName: string;
  productProblemSolved: string;
  mainProductAsin: string;
  competitor1Asin?: string;
  competitor2Asin?: string;
  competitor3Asin?: string;
  industryCode: string;
  productUrl: string;
}

export default function ResearchHubPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedProductFromUrl = searchParams.get('productId') || searchParams.get('product');
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previousJobs, setPreviousJobs] = useState<Job[]>([]);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(selectedProductFromUrl);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [pauseAutoRefresh, setPauseAutoRefresh] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [customerModalTab, setCustomerModalTab] = useState<"scrape" | "upload">("scrape");
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadOnly, setUploadOnly] = useState(false);
  const [productCollectionForm, setProductCollectionForm] = useState<ProductCollectionFormData>({
    productUrl: "",
    returnsUrl: "",
    shippingUrl: "",
    aboutUrl: "",
  });
  const [adOcrCoverage, setAdOcrCoverage] = useState<{ totalAssets: number; assetsWithOcr: number }>({
    totalAssets: 0,
    assetsWithOcr: 0,
  });
  const [adCompleteness, setAdCompleteness] = useState<AdDataCompleteness | null>(null);
  const [adCompletenessLoading, setAdCompletenessLoading] = useState(false);
  const [adCompletenessWarning, setAdCompletenessWarning] = useState<string | null>(null);
  const selectedProductRef = useRef<string | null>(selectedProductId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Modal states
  const [activeStepModal, setActiveStepModal] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<{ step: ResearchStep; trackKey: string } | null>(null);
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [showRunAllModal, setShowRunAllModal] = useState(false);

  useEffect(() => {
    selectedProductRef.current = selectedProductId;
  }, [selectedProductId]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    console.log("Modal state changed:", activeStepModal);
  }, [activeStepModal]);

  const runGroups = jobs.reduce<Record<string, { runId: string; createdAt: string; jobs: Job[] }>>(
    (acc, job) => {
      const runId = job.runId ?? job.id;
      if (!acc[runId]) {
        acc[runId] = {
          runId,
          createdAt: job.createdAt,
          jobs: [],
        };
      }
      acc[runId].jobs.push(job);
      if (new Date(job.createdAt).getTime() > new Date(acc[runId].createdAt).getTime()) {
        acc[runId].createdAt = job.createdAt;
      }
      return acc;
    },
    {}
  );

  const runGroupsList = Object.values(runGroups);
  const runGroupsWithNumbers = runGroupsList
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((run, index) => ({
      ...run,
      runNumber: index + 1,
      jobCount: run.jobs.length,
      label: (() => {
        const jobTypes = Array.from(new Set(run.jobs.map((j) => j.type)));
        const hasCustomer = jobTypes.some(
          (t) => t === "CUSTOMER_RESEARCH" || t === "CUSTOMER_ANALYSIS"
        );
        const hasAd = jobTypes.some(
          (t) => t === "AD_PERFORMANCE" || t === "PATTERN_ANALYSIS"
        );
        const hasProduct = jobTypes.some(
          (t) => t === "PRODUCT_DATA_COLLECTION" || t === "PRODUCT_ANALYSIS"
        );
        return (
          [hasCustomer ? "Customer" : null, hasAd ? "Ad" : null, hasProduct ? "Product" : null]
            .filter(Boolean)
            .join(" + ") || "Research"
        );
      })(),
    }));

  const sortedRuns = runGroupsWithNumbers.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const selectedRun = selectedRunId ? sortedRuns.find((run) => run.runId === selectedRunId) : null;

  const selectedRunCustomerJob = selectedRun
    ? selectedRun.jobs
        .filter((j) => j.type === "CUSTOMER_RESEARCH" && j.status === "COMPLETED")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;

  const selectedRunAnalysisJob = selectedRun
    ? selectedRun.jobs
        .filter((j) => j.type === "CUSTOMER_ANALYSIS")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;

  const analysisStatusJob = selectedRunId ? selectedRunAnalysisJob : null;

  const canRunAnalysis = Boolean(selectedRunId) && jobs.some(
    (j) =>
      j.runId === selectedRunId &&
      j.type === "CUSTOMER_RESEARCH" &&
      j.status === "COMPLETED"
  );

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

  const loadAdOcrCoverage = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/ad-ocr-status`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setAdOcrCoverage({
        totalAssets: Number(data?.totalAssets ?? 0),
        assetsWithOcr: Number(data?.assetsWithOcr ?? 0),
      });
    } catch (error) {
      console.error("[loadAdOcrCoverage] Error:", error);
    }
  }, [projectId]);

  const loadAdCompleteness = useCallback(
    async (runId?: string | null) => {
      const runParam = runId || currentRunId || selectedRunId || "";
      const query = runParam ? `?runId=${encodeURIComponent(runParam)}` : "";
      setAdCompletenessLoading(true);
      setAdCompletenessWarning(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/ad-data-completeness${query}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          console.warn("Completeness check failed, deferring to server-side validation");
          setAdCompleteness(null);
          setAdCompletenessWarning(
            "Unable to verify data completeness. Click to attempt analysis."
          );
          return;
        }
        const data = await response.json();
        if (data?.success && data?.completeness) {
          setAdCompleteness(data.completeness as AdDataCompleteness);
          setAdCompletenessWarning(null);
        } else {
          setAdCompleteness(null);
          setAdCompletenessWarning(
            "Unable to verify data completeness. Server will validate when you run analysis."
          );
        }
      } catch (error) {
        console.warn("Completeness API unavailable:", error);
        setAdCompleteness(null);
        setAdCompletenessWarning(
          "Unable to verify data completeness. Server will validate when you run analysis."
        );
      } finally {
        setAdCompletenessLoading(false);
      }
    },
    [currentRunId, projectId, selectedRunId]
  );

  const loadJobs = useCallback(async (forceProductId?: string, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    console.log('[loadJobs] Starting job fetch...', { projectId, forceProductId, timestamp: new Date().toISOString() });
    if (!silent) setLoading(true);
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
      const productToFilter = (forceProductId ?? selectedProductRef.current) || null;
      const filteredJobs = (Array.isArray(data.jobs) ? data.jobs : []).filter((j: any) => {
        if (!productToFilter) return true;
        const jobProductId = String(j?.payload?.productId || "").trim();
        // Keep project-level jobs (no productId), plus jobs tied to selected product.
        return !jobProductId || jobProductId === String(productToFilter);
      });

      setJobs((prevJobs) => {
        setPreviousJobs(prevJobs);
        return filteredJobs || [];
      });
      console.log('[loadJobs] Jobs filtered:', { productId: productToFilter, filteredCount: filteredJobs.length });
      await loadAdOcrCoverage();
      await loadAdCompleteness();
    } catch (error) {
      console.error('[loadJobs] Error:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loadAdCompleteness, loadAdOcrCoverage, projectId]);

  const loadProducts = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/products`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load products");
      }
      const productList = Array.isArray(data.products) ? data.products : [];
      setProducts(productList);

      if (productList.length === 0) {
        setSelectedProductId(null);
        return;
      }

      const selected = selectedProductRef.current;
      const exists = selected && productList.some((p: ProductOption) => p.id === selected);
      const defaultProductId = exists ? selected : productList[0].id;
      if (defaultProductId !== selected) {
        setSelectedProductId(defaultProductId);
        const url = new URL(window.location.href);
        url.searchParams.set('productId', defaultProductId);
        url.searchParams.delete('product');
        router.replace(url.pathname + url.search, { scroll: false });
      }
    } catch (error) {
      console.error('[loadProducts] Error:', error);
      setProducts([]);
    }
  }, [projectId, router]);

  // Load products on mount
  useEffect(() => {
    if (projectId) {
      loadProducts();
    }
  }, [loadProducts, projectId]);

  // Load jobs when selected product changes
  useEffect(() => {
    if (projectId) {
      loadJobs(selectedProductId || undefined);
    }
  }, [loadJobs, projectId, selectedProductId]);

  useEffect(() => {
    if (!projectId) return;
    loadAdCompleteness();
  }, [loadAdCompleteness, projectId]);

  const runningJob = useMemo(
    () => jobs.find((j) => j.status === "RUNNING") ?? null,
    [jobs]
  );
  const hasRunningJob = Boolean(runningJob);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  // Auto-refresh jobs every 3 seconds for live status updates
  useEffect(() => {
    if (!projectId || pauseAutoRefresh) return;

    const interval = setInterval(() => {
      loadJobs(selectedProductId || undefined, { silent: true });
    }, 3000);

    return () => clearInterval(interval);
  }, [loadJobs, pauseAutoRefresh, projectId, selectedProductId]);

  // Detect job completions and show inline status
  useEffect(() => {
    if (previousJobs.length === 0) return;

    const newCompletions = jobs.filter(job => 
      job.status === 'COMPLETED' && 
      previousJobs.find(prev => prev.id === job.id && prev.status === 'RUNNING')
    );
    
    newCompletions.forEach(job => {
      setStatusMessage(`${getJobTypeLabel(job.type)} completed`);
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
          id: "ad-ocr",
          label: "Extract OCR",
          description: "Extract text overlays from ad creatives",
          jobType: "AD_PERFORMANCE",
          endpoint: "/api/jobs/ad-ocr",
          prerequisite: "ad-collection",
          status: "NOT_STARTED",
        },
        {
          id: "ad-transcripts",
          label: "Extract Transcripts",
          description: "Convert ads to text transcripts",
          jobType: "AD_PERFORMANCE",
          endpoint: "/api/jobs/ad-transcripts",
          prerequisite: "ad-ocr",
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
      ],
    },
  ];

  // Get step status based on current run
  const getStepStatus = (jobType: JobType, stepId: string): { status: JobStatus; lastJob?: Job } => {
    if (jobType === "AD_PERFORMANCE") {
      // Ad pipeline uses project-level filtering by subtype (not strict run-only matching).
      const matchingJobs = jobs.filter((j) => {
        const jobSubtype = j.payload?.jobType || j.metadata?.jobType;
        if (stepId === "ad-collection") return jobSubtype === "ad_raw_collection";
        if (stepId === "ad-ocr") return jobSubtype === "ad_ocr_collection";
        if (stepId === "ad-transcripts") {
          return jobSubtype === "ad_transcripts" || jobSubtype === "ad_transcript_collection";
        }
        return false;
      });

      const job = [...matchingJobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (stepId === "ad-ocr" && adOcrCoverage.totalAssets > 0) {
        if (adOcrCoverage.assetsWithOcr >= adOcrCoverage.totalAssets) {
          return { status: "COMPLETED", lastJob: job };
        }
      }

      if (!job) {
        return { status: "NOT_STARTED" };
      }

      return {
        status: job.status,
        lastJob: job,
      };
    }

    if (!currentRunId) {
      return { status: "NOT_STARTED" };
    }

    const job = jobs.find(j => j.type === jobType && j.runId === currentRunId);
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
    if (step.id === "customer-analysis") return true;
    if (step.status === "RUNNING" || step.status === "PENDING") return false;
    if (step.id === "pattern-analysis") {
      if (adCompleteness && !adCompleteness.canRun) return false;
      // If completeness API is unavailable, allow run and rely on server-side validation.
      return true;
    }

    if (!step.prerequisite) return true;

    // Special handling for customer-analysis: check if ANY completed customer research exists
    if (step.id === "customer-analysis") {
      const hasCompletedResearch = Boolean(currentRunId) && jobs.some(
        (j) =>
          j.type === "CUSTOMER_RESEARCH" &&
          j.status === "COMPLETED" &&
          j.runId === currentRunId
      );
      return hasCompletedResearch;
    }

    // Default: check prerequisite step status
    const prerequisiteStep = track.steps.find((s) => s.id === step.prerequisite);
    return prerequisiteStep?.status === "COMPLETED";
  };

  // Run a step - show modal or execute directly
  const runStep = async (step: ResearchStep, trackKey: string) => {
    console.log("runStep called:", step.id, trackKey);

    // Product collection doesn't need product selected - URL comes from modal
    if (step.id === "product-collection") {
      const nextPendingStep = { step, trackKey };
      setPendingStep(nextPendingStep);
      setActiveStepModal(step.id);
      console.log("Modal open requested:", {
        nextPendingStep,
        nextActiveStepModal: step.id,
        shouldOpenModal: true,
      });
      return;
    }

    console.log("selectedProductId check:", selectedProductId);
    if (!selectedProductId) {
      console.log("BLOCKED: No product selected");
      setStatusMessage("Create/select a product before running research jobs.");
      return;
    }
    const track = updatedTracks.find((t) => t.key === trackKey)!;
    console.log("canRun inputs:", { stepId: step.id, track, step });
    const canRunResult = canRun(step, track);
    console.log("canRun result:", canRunResult);
    if (!canRunResult) return;

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
    }

    // Execute directly for steps without input
    await executeStep(step, {});
  };

  // Execute step with payload
  const executeStep = async (step: ResearchStep, formData: any) => {
    setRunningStep(step.id);

    try {
      let payload: any = {
        projectId,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
        ...formData,
      };

      // Add step-specific data
      if (step.id === "customer-analysis") {
        const currentRunResearchJob = jobs.find(
          (j) =>
            j.runId === currentRunId &&
            j.type === "CUSTOMER_RESEARCH" &&
            j.status === "COMPLETED"
        );

        payload = {
          projectId,
          ...(selectedProductId ? { productId: selectedProductId } : {}),
          runId: currentRunId,
          productProblemSolved: currentRunResearchJob?.payload?.productProblemSolved,
          solutionKeywords: Array.isArray(currentRunResearchJob?.payload?.solutionKeywords)
            ? currentRunResearchJob?.payload?.solutionKeywords
            : [],
          additionalProblems: Array.isArray(currentRunResearchJob?.payload?.additionalProblems)
            ? currentRunResearchJob?.payload?.additionalProblems
            : [],
        };
      } else if (step.id === "ad-ocr" || step.id === "ad-transcripts") {
        payload = {
          ...payload,
          ...(currentRunId ? { runId: currentRunId } : {}),
        };
      }

      console.log("executeStep calling:", step.endpoint, payload);

      const response = await fetch(step.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!data.success && !response.ok) {
        throw new Error(data.error || "Failed to start job");
      }

      if (data.runId) {
        setCurrentRunId(data.runId);
        setSelectedRunId(data.runId);
      }

      // Reload jobs to see the new job
      await loadJobs();
      setStatusMessage("Job started");
    } catch (error: any) {
      console.error(`Failed to run ${step.label}:`, error);
      setStatusMessage(error.message || "Failed to start job");
    } finally {
      setRunningStep(null);
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
      });

      if (response.ok) {
        setStatusMessage("Job cancelled");
        loadJobs();
        return;
      }

      const data = await response.json().catch(() => ({}));
      setStatusMessage(data?.error || "Failed to cancel job");
    } catch (error) {
      setStatusMessage("Error cancelling job");
    }
  };

  // Handle modal submissions
  const handleCustomerResearchSubmit = async (formData: CustomerResearchFormData) => {
    if (!pendingStep) return;
    const normalizedProblem = formData.productProblemSolved.trim();

    const payload = {
      ...(normalizedProblem && { productProblemSolved: normalizedProblem }),
      additionalProblems: formData.additionalProblems
        .split(/[\n,]/)
        .map((problem) => problem.trim())
        .filter(Boolean),
      // TODO - replace with actual form that collects up to 4 ASINs
      mainProductAsin: formData.mainProductAsin,
      ...(formData.competitor1Asin && { competitor1Asin: formData.competitor1Asin }),
      ...(formData.competitor2Asin && { competitor2Asin: formData.competitor2Asin }),
      ...(formData.competitor3Asin && { competitor3Asin: formData.competitor3Asin }),
      // Reddit search parameters
      searchIntent: formData.searchIntent.split(',').map(k => k.trim()).filter(Boolean),
      solutionKeywords: formData.solutionKeywords.split(',').map(k => k.trim()).filter(Boolean),
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
    if (!selectedProductId) {
      setStatusMessage("Create/select a product before running product collection.");
      return;
    }

    const productUrl = String(formData.productUrl || productCollectionForm.productUrl || "").trim();
    if (!productUrl) {
      setStatusMessage("Product URL is required.");
      return;
    }

    try {
      const response = await fetch("/api/jobs/product-data-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productId: selectedProductId,
          productName: selectedProduct?.name,
          productUrl,
          returnsUrl: productCollectionForm.returnsUrl,
          shippingUrl: productCollectionForm.shippingUrl,
          aboutUrl: productCollectionForm.aboutUrl,
          runId: currentRunId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to start job");
      }
      const data = await response.json().catch(() => ({}));
      if (data?.runId) {
        setCurrentRunId(data.runId);
        setSelectedRunId(data.runId);
      }

      setActiveStepModal(null);
      setPendingStep(null);
      setStatusMessage("Product collection started.");
      await loadJobs(selectedProductId);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to start job");
    }
  };

  const handleStartNewRun = () => {
    setCurrentRunId(null);
    setShowNewRunModal(false);
    setStatusMessage("New research run started");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRunAllResearch = async (formData: RunAllResearchFormData) => {
    if (!selectedProductId) {
      setStatusMessage("Create/select a product before running research jobs.");
      return;
    }
    setShowRunAllModal(false);
    
    const runId = crypto.randomUUID();
    setCurrentRunId(runId);
    setSelectedRunId(runId);
    
    setStatusMessage("Starting all research jobs...");
    
    try {
      const runResponse = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          projectId,
        }),
      });
      if (!runResponse.ok) {
        const runData = await runResponse.json().catch(() => ({}));
        throw new Error(runData?.error || "Failed to create run");
      }

      // Start Customer Research
      const customerResearchPayload = {
        projectId,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
        runId,
        productProblemSolved: formData.productProblemSolved,
        // TODO - replace with actual form that collects up to 4 ASINs
        mainProductAsin: formData.mainProductAsin,
        ...(formData.competitor1Asin && { competitor1Asin: formData.competitor1Asin }),
        ...(formData.competitor2Asin && { competitor2Asin: formData.competitor2Asin }),
        ...(formData.competitor3Asin && { competitor3Asin: formData.competitor3Asin }),
      };
      
      const customerResponse = await fetch('/api/jobs/customer-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerResearchPayload),
      });
      if (!customerResponse.ok) {
        const data = await customerResponse.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to start customer research");
      }
      
      // Start Ad Collection
      const adCollectionPayload = {
        projectId,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
        runId,
        industryCode: formData.industryCode,
      };
      
      const adResponse = await fetch('/api/jobs/ad-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adCollectionPayload),
      });
      if (!adResponse.ok) {
        const data = await adResponse.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to start ad collection");
      }
      
      // Start Product Data Collection
      const productCollectionPayload = {
        projectId,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
        runId,
        productName: formData.productName,
        productUrl: formData.productUrl,
      };
      
      const productResponse = await fetch('/api/jobs/product-data-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productCollectionPayload),
      });
      if (!productResponse.ok) {
        const data = await productResponse.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to start product collection");
      }
      
      await loadJobs();
      setStatusMessage("All research jobs started");
    } catch (error: any) {
      console.error("Failed to start research jobs:", error);
      setStatusMessage(error.message || "Failed to start some research jobs");
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
              Research Hub{selectedProduct ? ` - ${selectedProduct.name}` : ""}
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
          {selectedProductId && (
            <Link
              href={`/projects/${projectId}/research/data?productId=${selectedProductId}`}
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
            {statusMessage && (
              <p className="mb-2 text-xs text-slate-300">{statusMessage}</p>
            )}
            {hasRunningJob && (
              <div className="mb-4 p-4 bg-sky-500/10 border border-sky-500/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium text-sky-300">RUNNING</p>
                    <p className="text-xs text-slate-400">
                      {runningJob ? getJobTypeLabel(runningJob.type) : "Processing"}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {products.length > 0 ? (
              <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                <div className="text-xs text-slate-500 mb-1">Current Product</div>
                <div className="text-sm font-medium text-slate-100 mb-2">
                  {selectedProduct?.name || "Select a product"}
                </div>
                <select
                  value={selectedProductId || ''}
                  onChange={(e) => {
                    const newProductId = e.target.value;
                    setPauseAutoRefresh(true);
                    setSelectedProductId(newProductId);
                    const url = new URL(window.location.href);
                    url.searchParams.set('productId', newProductId);
                    url.searchParams.delete('product');
                    router.replace(url.pathname + url.search, { scroll: false });
                    loadJobs(newProductId);
                    setTimeout(() => setPauseAutoRefresh(false), 10000);
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-slate-500">
                  Switching between {products.length} product{products.length === 1 ? "" : "s"}
                </div>
                <Link
                  href={`/projects/${projectId}`}
                  className="mt-2 inline-block text-xs text-sky-400 hover:text-sky-300"
                >
                  ← Manage Products
                </Link>
              </div>
            ) : (
              <p className="text-sm text-slate-400 mb-3">
                No products found. Create one in the project dashboard first.
              </p>
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
                  Run #{run.runNumber} ({run.label}, {run.jobCount} jobs) - Last: {getLastJobStatus(run.jobs)} - {formatRunDate(run.createdAt)}
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
                    const stepStatus = getStepStatus(step.jobType, step.id);
                    const stepWithStatus = {
                      ...step,
                      status: stepStatus.status,
                      lastJob: stepStatus.lastJob,
                    };
                    const locked = !canRun(stepWithStatus, track);
                    const analysisRunning = Boolean(selectedRunId) && jobs.some(
                      (job) =>
                        job.type === "CUSTOMER_ANALYSIS" &&
                        job.status === "RUNNING" &&
                        job.runId === selectedRunId
                    );
                    const isRunning = runningStep === stepWithStatus.id;
                    const isCustomerCollectionStep = stepWithStatus.label === "Customer Collection";
                    const isProductCollectionStep = stepWithStatus.label === "Product Collection";
                    const isCollecting =
                      (isCustomerCollectionStep && (isRunning || hasRunningJob)) ||
                      (isProductCollectionStep && isRunning);
                    const patternAnalysisBlockedReason =
                      stepWithStatus.id === "pattern-analysis" && adCompleteness && !adCompleteness.canRun
                        ? adCompleteness.reason ?? "Pattern analysis requirements not met."
                        : null;
                    const patternAnalysisWarning =
                      stepWithStatus.id === "pattern-analysis" && !patternAnalysisBlockedReason
                        ? adCompletenessWarning
                        : null;
                    const customerResearchJob = stepWithStatus.jobType === "CUSTOMER_RESEARCH"
                      ? latestCompletedCustomerResearchJob
                      : undefined;
                    return (
                      <div
                        key={stepWithStatus.id}
                        className="flex items-start gap-4 p-4 rounded-lg bg-slate-900/50 border border-slate-800"
                      >
                        {/* Step Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white mb-1">
                            {stepWithStatus.label}
                          </h3>
                          <p className="text-xs text-slate-400 mb-2">{stepWithStatus.description}</p>
                          {stepWithStatus.id === "ad-ocr" && (
                            <p className="text-xs text-slate-500 mb-2">
                              OCR coverage: {adOcrCoverage.assetsWithOcr}/{adOcrCoverage.totalAssets}
                            </p>
                          )}
                          {stepWithStatus.id === "pattern-analysis" && (
                            <>
                              {adCompletenessLoading ? (
                                <p className="text-xs text-slate-500 mb-2">Checking data completeness...</p>
                              ) : adCompleteness ? (
                                <p className="text-xs text-slate-500 mb-2">
                                  Complete ads: {adCompleteness.withAllData}/{adCompleteness.totalAds} ·
                                  OCR {Math.round(adCompleteness.ocrCoverage * 100)}% ·
                                  Transcripts {Math.round(adCompleteness.transcriptCoverage * 100)}%
                                </p>
                              ) : null}
                              {patternAnalysisBlockedReason && (
                                <p className="text-xs text-amber-400 mb-2 whitespace-pre-line">
                                  {patternAnalysisBlockedReason}
                                </p>
                              )}
                              {patternAnalysisWarning && (
                                <p className="text-xs text-yellow-400 mb-2">{patternAnalysisWarning}</p>
                              )}
                            </>
                          )}
                          {stepWithStatus.label === "Customer Analysis"
                            ? selectedRunId && analysisStatusJob && (
                                <StatusBadge status={analysisStatusJob.status} />
                              )
                            : stepWithStatus.status !== "NOT_STARTED" && <StatusBadge status={stepWithStatus.status} />}
                          {stepWithStatus.label === "Customer Analysis" && analysisRunning && (
                            <div className="mt-2 text-xs text-slate-400">Analysis in progress...</div>
                          )}

                          {/* Error Display */}
                          {stepWithStatus.status === "FAILED" && stepWithStatus.lastJob?.error && (
                            <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-red-300 mb-1">Error Details:</p>
                                  <p className="text-xs text-red-400">{stepWithStatus.lastJob.error}</p>
                                </div>
                                <button
                                  onClick={() => runStep(stepWithStatus, track.key)}
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
                          {stepWithStatus.jobType === "CUSTOMER_RESEARCH" ? (
                            customerResearchJob && (
                            <div className="flex flex-col gap-1">
                              <>
                                {selectedRunCustomerJob ? (
                                  <Link
                                    href={`/projects/${projectId}/research/data/${selectedRunCustomerJob.id}?runId=${selectedRunCustomerJob.runId ?? selectedRunCustomerJob.id}`}
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
                                    ? `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}?runId=${currentRunId}`
                                    : `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}`;
                                  router.push(url);
                                }}
                                className="text-slate-400 hover:text-slate-300 text-xs underline"
                              >
                                {currentRunId ? 'View Run History' : 'View All History'}
                              </button>
                            </div>
                            )
                          ) : stepWithStatus.label === "Customer Analysis" ? (
                            <div className="flex flex-col gap-1">
                              {selectedRunId && analysisStatusJob?.status === "COMPLETED" && (
                                <Link
                                  href={`/projects/${projectId}/research-hub/analysis/data/${analysisStatusJob.id}`}
                                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
                                >
                                  View Results
                                </Link>
                              )}
                              <button
                                onClick={() => {
                                  const url = currentRunId
                                    ? `/projects/${projectId}/research-hub/jobs/customer-analysis?runId=${currentRunId}`
                                    : `/projects/${projectId}/research-hub/jobs/customer-analysis`;
                                  router.push(url);
                                }}
                                className="text-slate-400 hover:text-slate-300 text-xs underline"
                              >
                              {currentRunId ? "View Run History" : "View All History"}
                              </button>
                            </div>
                          ) : (
                          stepWithStatus.status === "COMPLETED" && stepWithStatus.lastJob && (
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => {
                                  const url = currentRunId 
                                    ? `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}?runId=${currentRunId}`
                                    : `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}`;
                                  router.push(url);
                                }}
                                className="text-slate-400 hover:text-slate-300 text-xs underline"
                              >
                                {currentRunId ? 'View Run History' : 'View All History'}
                              </button>
                            </div>
                          ))}
                          {stepWithStatus.label === "Customer Analysis" ? (
                            <button
                              onClick={() => runStep(stepWithStatus, track.key)}
                              disabled={!canRunAnalysis || isRunning}
                              className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 ${
                                !canRunAnalysis || isRunning
                                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                                  : `bg-${track.color}-500 hover:bg-${track.color}-400 text-white`
                              }`}
                              title={!canRunAnalysis ? "Complete Customer Collection first" : undefined}
                            >
                              {isRunning ? "Starting..." : "Run"}
                            </button>
                          ) : stepWithStatus.status === "COMPLETED" ? (
                            <div className="flex flex-col gap-1">
                              {isCollecting && (
                                <div className="text-xs text-blue-400">Running...</div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => runStep(stepWithStatus, track.key)}
                                  disabled={isRunning || isCollecting}
                                  className={`px-3 py-1 text-sm rounded ${
                                    isRunning || isCollecting
                                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                      : "bg-blue-600 hover:bg-blue-700 text-white"
                                  }`}
                                >
                                  {stepWithStatus.label === "Customer Analysis"
                                    ? "Re-run Analysis"
                                    : stepWithStatus.label === "Customer Collection"
                                      ? "Collect Data"
                                      : "Re-run"}
                                </button>
                                {stepWithStatus.lastJob && (
                                  <button
                                    onClick={() => {
                                      console.log("=== JOB DATA ===");
                                      console.log("Input:", stepWithStatus.lastJob?.payload);
                                      console.log("Output:", stepWithStatus.lastJob?.result);
                                      alert(`Check console for ${stepWithStatus.label} data`);
                                    }}
                                    className="px-2 py-1 text-xs text-gray-400 hover:text-gray-300 border border-gray-600 rounded"
                                  >
                                    View Data
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {isCollecting && (
                                <div className="text-xs text-blue-400">Running...</div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => runStep(stepWithStatus, track.key)}
                                  disabled={
                                    locked ||
                                    isRunning ||
                                    (isCustomerCollectionStep && hasRunningJob) ||
                                    (stepWithStatus.label === "Customer Analysis" && !canRunAnalysis) ||
                                    (stepWithStatus.label === "Customer Analysis" && analysisRunning)
                                  }
                                  className={`px-3 py-1 text-sm rounded ${
                                    locked || isRunning || (isCustomerCollectionStep && hasRunningJob) || (stepWithStatus.label === "Customer Analysis" && (analysisRunning || !canRunAnalysis))
                                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                      : "bg-blue-600 hover:bg-blue-700 text-white"
                                  }`}
                                  title={patternAnalysisBlockedReason || patternAnalysisWarning || undefined}
                                >
                                  {isRunning
                                    ? "Starting..."
                                    : locked
                                      ? "🔒 Locked"
                                      : stepWithStatus.label === "Customer Collection"
                                        ? "Collect Data"
                                        : stepWithStatus.label === "Customer Analysis"
                                          ? analysisRunning
                                            ? "Running..."
                                            : "Run Analysis"
                                          : "Run"}
                                </button>
                              </div>
                            </div>
                          )}
                          {stepWithStatus.status === "RUNNING" && stepWithStatus.lastJob && (
                            <button
                              onClick={() => cancelJob(stepWithStatus.lastJob!.id)}
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                            >
                              Cancel
                            </button>
                          )}
                        </div>

                        {/* Step Modal - Render inline */}
                        {activeStepModal === stepWithStatus.id && (
                          <>
                            {stepWithStatus.id === "customer-research" && (
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
                            {stepWithStatus.id === "ad-collection" && (
                              <AdCollectionModal
                                onSubmit={handleAdCollectionSubmit}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                }}
                              />
                            )}
                            {stepWithStatus.id === "product-collection" && (
                              <ProductCollectionModal
                                onSubmit={handleProductCollectionSubmit}
                                formData={productCollectionForm}
                                setFormData={setProductCollectionForm}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                  setProductCollectionForm({
                                    productUrl: "",
                                    returnsUrl: "",
                                    shippingUrl: "",
                                    aboutUrl: "",
                                  });
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
                        <div>Total reviews</div><div className="text-right">{rs.amazon.productTotal ?? 0}</div>
                        <div>Competitor reviews</div><div className="text-right">
                          {(rs.amazon.competitor1Total ?? 0) + (rs.amazon.competitor2Total ?? 0)}
                        </div>
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
    productProblemSolved: "",
    additionalProblems: "",
    mainProductAsin: "",
    competitor1Asin: "",
    competitor2Asin: "",
    competitor3Asin: "",
    searchIntent: "",
    solutionKeywords: "",
    maxPosts: 50,
    maxCommentsPerPost: 50,
    timeRange: 'month',
    scrapeComments: true,
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
    setUploadFile(null);
    setUploading(false);
    setFormError(null);
    setUploadMessage(null);
  }, [initialTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const hasAmazonAsin =
      formData.mainProductAsin?.trim() ||
      formData.competitor1Asin?.trim() ||
      formData.competitor2Asin?.trim() ||
      formData.competitor3Asin?.trim();
    const hasRedditData = formData.productProblemSolved?.trim();

    if (!hasAmazonAsin && !hasRedditData) {
      setFormError("Provide at least one Amazon ASIN (product or competitor) or valid Reddit inputs.");
      return;
    }
    onSubmit(formData);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadMessage(null);
    if (!uploadFile) {
      setUploadMessage("Please select a file.");
      return;
    }
    if (!uploadJobId) {
      setUploadMessage("Missing job reference for upload.");
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
      setUploadMessage(`Added ${data.rowsAdded} rows from uploaded file.`);
      router.refresh();
      onClose();
    } catch (error: any) {
      setUploadMessage(error.message || "Upload failed");
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
          {formError && <p className="text-sm text-red-400 mb-3">{formError}</p>}
          {uploadMessage && <p className="text-sm text-slate-300 mb-3">{uploadMessage}</p>}

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
                Problem to Research <span className="text-slate-500">(required)</span>
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
                Additional Problems <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                value={formData.additionalProblems}
                onChange={(e) => setFormData({ ...formData, additionalProblems: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder={"e.g.,\nbreakouts before period\nsensitive skin irritation"}
                rows={3}
              />
              <p className="text-xs text-slate-500 mt-1">One per line or comma-separated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Solution Keywords (optional)
                <span className="ml-2 text-xs text-slate-500">
                  Specific solutions, products, or alternatives to search for
                </span>
              </label>
              <input
                type="text"
                value={formData.solutionKeywords}
                onChange={(e) => setFormData({ ...formData, solutionKeywords: e.target.value })}
                placeholder="e.g., tretinoin, accutane, birth control"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Comma-separated. Search for discussions about specific solutions/alternatives
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Amazon ASIN <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.mainProductAsin}
                onChange={(e) => setFormData({ ...formData, mainProductAsin: e.target.value })}
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

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Competitor 3 ASIN <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.competitor3Asin}
                onChange={(e) => setFormData({ ...formData, competitor3Asin: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g., B0GHI3456"
              />
            </div>

            {/* Reddit Search Settings */}
            <div className="border-t border-slate-700 pt-6 mt-6">
              <h3 className="text-lg font-semibold text-slate-200 mb-4">Reddit Search Settings</h3>
              <p className="text-sm text-slate-400 mb-6">
                Reddit search is problem-focused. Use optional fields below to control intent, keywords, and alternatives.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Search Intent (optional)
                    <span className="ml-2 text-xs text-slate-500">
                      What type of discussions to find
                    </span>
                  </label>
                  <input
                    type="text"
                    value={formData.searchIntent}
                    onChange={(e) => setFormData({ ...formData, searchIntent: e.target.value })}
                    placeholder="e.g., routine, help, what worked, recommend, tried everything"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Comma-separated phrases. Examples: &quot;routine&quot;, &quot;help&quot;, &quot;what worked&quot;, &quot;tried everything&quot;, &quot;side effects&quot;
                  </p>
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!industryCode) {
      setErrorMessage("Please enter an industry code.");
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
          {errorMessage && <p className="text-sm text-red-400 mb-3">{errorMessage}</p>}

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
  formData,
  setFormData,
  onClose,
}: {
  onSubmit: (data: ProductCollectionFormData) => void;
  formData: ProductCollectionFormData;
  setFormData: (next: ProductCollectionFormData) => void;
  onClose: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!formData.productUrl) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Product Information</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your product URL
          </p>
          {errorMessage && <p className="text-sm text-red-400 mb-3">{errorMessage}</p>}

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <input
                type="url"
                value={formData.returnsUrl}
                onChange={(e) => setFormData({ ...formData, returnsUrl: e.target.value })}
                placeholder="Returns/Refund Policy URL (optional)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
              />
            </div>
            <div>
              <input
                type="url"
                value={formData.shippingUrl}
                onChange={(e) => setFormData({ ...formData, shippingUrl: e.target.value })}
                placeholder="Shipping Policy URL (optional)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
              />
            </div>
            <div>
              <input
                type="url"
                value={formData.aboutUrl}
                onChange={(e) => setFormData({ ...formData, aboutUrl: e.target.value })}
                placeholder="About/Standards URL (optional)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
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
    mainProductAsin: "",
    competitor1Asin: "",
    competitor2Asin: "",
    competitor3Asin: "",
    industryCode: "",
    productUrl: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!formData.productName || !formData.productProblemSolved || !formData.mainProductAsin || !formData.industryCode || !formData.productUrl) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Run All Research</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter all details to start customer, ad, and product research simultaneously
          </p>
          {errorMessage && <p className="text-sm text-red-400 mb-3">{errorMessage}</p>}

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
                      value={formData.mainProductAsin}
                      onChange={(e) => setFormData({ ...formData, mainProductAsin: e.target.value })}
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
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Competitor 3 ASIN
                    </label>
                    <input
                      type="text"
                      value={formData.competitor3Asin}
                      onChange={(e) => setFormData({ ...formData, competitor3Asin: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="B0GHI3456"
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
