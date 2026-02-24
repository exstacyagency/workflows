"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getJobTypeLabel } from "@/lib/jobLabels";
import RunManagementModal from "@/components/RunManagementModal";

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

interface ProjectRunMetadata {
  id: string;
  name: string | null;
  runNumber: number;
}

interface ResearchStep {
  id: string;
  label: string;
  description: string;
  jobType: JobType;
  endpoint: string;
  prerequisite?: string;
  prerequisites?: string[];
  status: JobStatus;
  lastJob?: Job;
  attemptCount?: number;
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

const RESEARCH_JOB_TYPES = new Set<string>([
  "CUSTOMER_RESEARCH",
  "CUSTOMER_ANALYSIS",
  "AD_PERFORMANCE",
  "AD_QUALITY_GATE",
  "PATTERN_ANALYSIS",
  "PRODUCT_DATA_COLLECTION",
  "PRODUCT_ANALYSIS",
]);

const INDUSTRY_SUGGESTIONS = [
  { code: "22000000000", label: "Apparel & Accessories" },
  { code: "16000000000", label: "Appliances" },
  { code: "20000000000", label: "Apps" },
  { code: "12000000000", label: "Baby, Kids & Maternity" },
  { code: "14000000000", label: "Beauty & Personal Care" },
  { code: "24000000000", label: "Business Services" },
  { code: "30000000000", label: "E-Commerce (Non-app)" },
  { code: "10000000000", label: "Education" },
  { code: "13000000000", label: "Financial Services" },
  { code: "27000000000", label: "Food & Beverage" },
  { code: "25000000000", label: "Games" },
  { code: "29000000000", label: "Health" },
  { code: "21000000000", label: "Home Improvement" },
  { code: "18000000000", label: "Household Products" },
  { code: "26000000000", label: "Life Services" },
  { code: "23000000000", label: "News & Entertainment" },
  { code: "19000000000", label: "Pets" },
  { code: "28000000000", label: "Sports & Outdoor" },
  { code: "15000000000", label: "Tech & Electronics" },
  { code: "17000000000", label: "Travel" },
  { code: "11000000000", label: "Vehicle & Transportation" },
] as const;
const DEFAULT_MODAL_INDUSTRY_CODE = "14000000000";

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
  const selectedProductRef = useRef<string | null>(selectedProductId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [projectRunsById, setProjectRunsById] = useState<Record<string, ProjectRunMetadata>>({});

  // Modal states
  const [activeStepModal, setActiveStepModal] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<{ step: ResearchStep; trackKey: string } | null>(null);
  const [showNewRunModal, setShowNewRunModal] = useState(false);
  const [showRunManagerModal, setShowRunManagerModal] = useState(false);

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
  const getRunJobName = (job: Job) => {
    if (job.type === "AD_PERFORMANCE") {
      const subtype = String(job.payload?.jobType || job.metadata?.jobType || "").trim();
      if (subtype === "ad_ocr_collection") return "Ad OCR";
      if (subtype === "ad_transcripts" || subtype === "ad_transcript_collection") {
        return "Ad Transcripts";
      }
      return "Ad Collection";
    }

    const names: Record<string, string> = {
      CUSTOMER_RESEARCH: "Customer Research",
      CUSTOMER_ANALYSIS: "Customer Analysis",
      AD_PERFORMANCE: "Ad Collection",
      AD_QUALITY_GATE: "Quality Assessment",
      PATTERN_ANALYSIS: "Pattern Analysis",
      PRODUCT_DATA_COLLECTION: "Product Collection",
      PRODUCT_ANALYSIS: "Product Analysis",
      SCRIPT_GENERATION: "Generate Script",
      STORYBOARD_GENERATION: "Create Storyboard",
      IMAGE_PROMPT_GENERATION: "Generate Image Prompts",
      VIDEO_PROMPT_GENERATION: "Generate Video Prompts",
      VIDEO_IMAGE_GENERATION: "Generate Images",
      VIDEO_GENERATION: "Generate Video",
      VIDEO_REVIEW: "Review Video",
      VIDEO_UPSCALER: "Upscale & Export",
    };
    return names[job.type] || job.type;
  };
  const runNumberByRunId = new Map(
    [...runGroupsList]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((run, index) => [run.runId, index + 1] as const)
  );

  const runGroupsWithNumbers = [...runGroupsList]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((run) => {
      const completedJobs = run.jobs
        .filter((j) => j.status === "COMPLETED")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const lastJob = completedJobs[0];
      const fallbackRunNumber = runNumberByRunId.get(run.runId) ?? 0;
      const metadata = projectRunsById[run.runId];
      const runNumber = metadata?.runNumber || fallbackRunNumber;
      const runLabel = metadata?.name?.trim() || `Run #${runNumber}`;
      const lastJobName = lastJob ? getRunJobName(lastJob) : "No jobs";

      return {
        ...run,
        runNumber,
        displayLabel: `${runLabel} - Last: ${lastJobName} ✓`,
        jobCount: run.jobs.length,
      };
    });

  const sortedRuns = runGroupsWithNumbers;

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
    } catch (error) {
      console.error('[loadJobs] Error:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loadAdOcrCoverage, projectId]);

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

  const loadProjectRuns = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runs`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) return;
      const runList = Array.isArray(data.runs) ? data.runs : [];
      const byId: Record<string, ProjectRunMetadata> = {};
      for (const run of runList) {
        const id = String(run?.id ?? "").trim();
        if (!id) continue;
        byId[id] = {
          id,
          name: typeof run?.name === "string" ? run.name : null,
          runNumber: Number(run?.runNumber ?? 0) || 0,
        };
      }
      setProjectRunsById(byId);
    } catch {
      // metadata enrichment is best-effort
    }
  }, [projectId]);

  // Load products on mount
  useEffect(() => {
    if (projectId) {
      loadProducts();
    }
  }, [loadProducts, projectId]);

  useEffect(() => {
    if (projectId) {
      void loadProjectRuns();
    }
  }, [loadProjectRuns, projectId]);

  // Load jobs when selected product changes
  useEffect(() => {
    if (projectId) {
      loadJobs(selectedProductId || undefined);
    }
  }, [loadJobs, projectId, selectedProductId]);

  const runningJob = useMemo(
    () => jobs.find((j) => j.status === "RUNNING") ?? null,
    [jobs]
  );
  const hasRunningJob = Boolean(runningJob);
  const anyRunning = jobs.some((j) => j.status === "RUNNING");
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const customerDataHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("jobType", "CUSTOMER_RESEARCH");
    if (selectedRunId) params.set("runId", selectedRunId);
    if (selectedProductId) params.set("productId", selectedProductId);
    if (selectedProduct?.name) params.set("product", selectedProduct.name);
    const query = params.toString();
    return `/projects/${projectId}/research/data${query ? `?${query}` : ""}`;
  }, [projectId, selectedProduct?.name, selectedProductId, selectedRunId]);
  const adDataHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("jobType", "ad-transcripts");
    if (selectedRunId) params.set("runId", selectedRunId);
    return `/projects/${projectId}/research-hub/data?${params.toString()}`;
  }, [projectId, selectedRunId]);
  const productDataHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("jobType", "PRODUCT_DATA_COLLECTION");
    if (selectedRunId) params.set("runId", selectedRunId);
    if (selectedProductId) params.set("productId", selectedProductId);
    if (selectedProduct?.name) params.set("product", selectedProduct.name);
    return `/projects/${projectId}/research/data?${params.toString()}`;
  }, [projectId, selectedProduct?.name, selectedProductId, selectedRunId]);

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

    const newCompletions = jobs.filter(
      (job) =>
        job.status === "COMPLETED" &&
        previousJobs.find((prev) => prev.id === job.id && prev.status === "RUNNING")
    );

    newCompletions.forEach((job) => {
      setStatusMessage(`${getRunJobName(job)} completed`);
      const jobSubtype = String(job.payload?.jobType || job.metadata?.jobType || "").trim();
      if (jobSubtype === "ad_raw_collection" && job.runId) {
        setCurrentRunId(job.runId);
        setSelectedRunId(job.runId);
      }
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
          prerequisite: "ad-collection",
          status: "NOT_STARTED",
        },
        {
          id: "ad-quality-gate",
          label: "Quality Assessment",
          description: "Filter to viable ad content before pattern analysis",
          jobType: "AD_QUALITY_GATE",
          endpoint: "/api/jobs/ad-quality-gate",
          prerequisites: ["ad-collection", "ad-ocr", "ad-transcripts"],
          status: "NOT_STARTED",
        },
        {
          id: "pattern-analysis",
          label: "Ad Analysis",
          description: "Identify winning ad patterns",
          jobType: "PATTERN_ANALYSIS",
          endpoint: "/api/jobs/pattern-analysis",
          prerequisite: "ad-quality-gate",
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
  const getStepStatus = (
    jobType: JobType,
    stepId: string
  ): { status: JobStatus; lastJob?: Job; attemptCount: number } => {
    if (jobType === "AD_PERFORMANCE") {
      const adRunId = currentRunId || selectedRunId;
      if (!adRunId) {
        return { status: "NOT_STARTED", attemptCount: 0 };
      }
      const matchingJobs = jobs.filter((j) => {
        const jobSubtype = j.payload?.jobType || j.metadata?.jobType;
        if (stepId === "ad-collection") return jobSubtype === "ad_raw_collection";
        if (stepId === "ad-ocr") return jobSubtype === "ad_ocr_collection";
        if (stepId === "ad-transcripts") {
          return jobSubtype === "ad_transcripts" || jobSubtype === "ad_transcript_collection";
        }
        return false;
      }).filter((j) => j.runId === adRunId);

      const job = [...matchingJobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (!job) {
        return { status: "NOT_STARTED", attemptCount: 0 };
      }

      if (stepId === "ad-ocr" && adOcrCoverage.totalAssets > 0) {
        if (adOcrCoverage.assetsWithOcr >= adOcrCoverage.totalAssets) {
          return { status: "COMPLETED", lastJob: job, attemptCount: matchingJobs.length };
        }
      }

      return {
        status: job.status,
        lastJob: job,
        attemptCount: matchingJobs.length,
      };
    }

    const activeRunId = currentRunId || selectedRunId;
    if (!activeRunId) {
      return { status: "NOT_STARTED", attemptCount: 0 };
    }

    const matchingJobs = jobs
      .filter((j) => j.type === jobType && j.runId === activeRunId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const job = matchingJobs[0];
    if (!job) {
      return { status: "NOT_STARTED", attemptCount: 0 };
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
      attemptCount: matchingJobs.length,
    };
  };

  // Update step statuses based on jobs
  const updatedTracks = tracks.map((track) => ({
    ...track,
    steps: track.steps.map((step) => {
      const { status, lastJob, attemptCount } = getStepStatus(step.jobType, step.id);
      
      return {
        ...step,
        status,
        lastJob,
        attemptCount,
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

  const latestJob = jobs.length
    ? jobs.reduce((latest, job) =>
        new Date(job.createdAt).getTime() > new Date(latest.createdAt).getTime() ? job : latest
      )
    : null;

  const recentResearchJobs = useMemo(
    () =>
      jobs
        .filter((job) => RESEARCH_JOB_TYPES.has(String(job.type)))
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [jobs]
  );

  const arePrerequisitesComplete = (step: ResearchStep, track: ResearchTrack): boolean => {
    const prerequisiteIds =
      Array.isArray(step.prerequisites) && step.prerequisites.length > 0
        ? step.prerequisites
        : step.prerequisite
          ? [step.prerequisite]
          : [];

    if (prerequisiteIds.length === 0) return true;

    return prerequisiteIds.every((prerequisiteId) => {
      const prerequisiteStep = track.steps.find((s) => s.id === prerequisiteId);
      return prerequisiteStep?.status === "COMPLETED";
    });
  };

  // Check if step can run
  const canRun = (step: ResearchStep, track: ResearchTrack): boolean => {
    if (step.status === "RUNNING" || step.status === "PENDING") return false;

    if (!arePrerequisitesComplete(step, track)) return false;

    // Special handling for customer-analysis: check if completed customer research exists in current run.
    if (step.id === "customer-analysis") {
      const hasCompletedResearch = Boolean(currentRunId) && jobs.some(
        (j) =>
          j.type === "CUSTOMER_RESEARCH" &&
          j.status === "COMPLETED" &&
          j.runId === currentRunId
      );
      return hasCompletedResearch;
    }

    if (step.id === "pattern-analysis") {
      const adCollectionStatus = track.steps.find((s) => s.id === "ad-collection")?.status;
      const ocrStatus = track.steps.find((s) => s.id === "ad-ocr")?.status;
      const transcriptStatus = track.steps.find((s) => s.id === "ad-transcripts")?.status;

      const canRunPatternAnalysis =
        adCollectionStatus === "COMPLETED" &&
        ocrStatus === "COMPLETED" &&
        transcriptStatus === "COMPLETED" &&
        track.steps.find((s) => s.id === "ad-quality-gate")?.status === "COMPLETED";

      return canRunPatternAnalysis;
    }
    
    return true;
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
      const activeRunId = String(selectedRunId ?? "").trim();
      const customPayload = {
        projectId,
        mainProductAsin: formData?.mainProductAsin,
        ...(selectedProductId ? { productId: selectedProductId } : {}),
        // If a run is selected, pin jobs to it. If "No active run", omit runId so run-aware APIs create one.
        ...(activeRunId ? { runId: activeRunId } : {}),
      };
      let payload: any = {
        ...formData,
        ...customPayload,
      };

      const resolveAdRunId = () => {
        if (activeRunId) return activeRunId;
        return null;
      };

      // Add step-specific data
      if (step.id === "customer-analysis") {
        const analysisRunId = activeRunId || null;
        const currentRunResearchJob = jobs.find(
          (j) =>
            j.runId === analysisRunId &&
            j.type === "CUSTOMER_RESEARCH" &&
            j.status === "COMPLETED"
        );

        payload = {
          projectId,
          ...(selectedProductId ? { productId: selectedProductId } : {}),
          ...(analysisRunId ? { runId: analysisRunId } : {}),
          productProblemSolved: currentRunResearchJob?.payload?.productProblemSolved,
          solutionKeywords: Array.isArray(currentRunResearchJob?.payload?.solutionKeywords)
            ? currentRunResearchJob?.payload?.solutionKeywords
            : [],
          additionalProblems: Array.isArray(currentRunResearchJob?.payload?.additionalProblems)
            ? currentRunResearchJob?.payload?.additionalProblems
            : [],
        };
      } else if (
        step.id === "ad-ocr" ||
        step.id === "ad-transcripts" ||
        step.id === "ad-quality-gate" ||
        step.id === "pattern-analysis"
      ) {
        const adRunId = resolveAdRunId();
        payload = {
          ...payload,
          ...(adRunId ? { runId: adRunId } : {}),
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
        void loadProjectRuns();
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
        void loadProjectRuns();
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

  const handleRunsChanged = useCallback(
    async (event: { type: "renamed" | "deleted"; runId: string }) => {
      if (event.type === "deleted") {
        if (selectedRunId === event.runId) {
          setSelectedRunId(null);
        }
        if (currentRunId === event.runId) {
          setCurrentRunId(null);
        }
      }
      await loadProjectRuns();
      await loadJobs(selectedProductId || undefined, { silent: true });
    },
    [currentRunId, loadJobs, loadProjectRuns, selectedProductId, selectedRunId],
  );

  const handleViewStepData = (step: ResearchStep & { lastJob?: Job }) => {
    const payloadRunId = String(step.lastJob?.payload?.runId ?? "").trim();
    const runId = step.lastJob?.runId || payloadRunId || currentRunId;

    if (step.id === "ad-collection" || step.id === "ad-ocr") {
      if (!runId) {
        setStatusMessage("No runId found for this ad job.");
        return;
      }
      const query = step.id === "ad-ocr" ? "?focus=ocr" : "";
      router.push(`/projects/${projectId}/research-hub/ad-assets/${runId}${query}`);
      return;
    }

    if (step.id === "ad-quality-gate") {
      if (!runId) {
        setStatusMessage("No runId found for this quality assessment job.");
        return;
      }
      router.push(`/projects/${projectId}/research-hub/data?jobType=ad-quality-gate&runId=${runId}`);
      return;
    }

    if (step.id === "pattern-analysis") {
      if (!runId) {
        setStatusMessage("No runId found for this ad analysis job.");
        return;
      }
      router.push(`/projects/${projectId}/research-hub/data?jobType=pattern-analysis&runId=${runId}`);
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
              {!latestJob && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>No runs yet</span>
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
            {statusMessage && (
              <p className="mb-2 text-xs text-slate-300">{statusMessage}</p>
            )}
            {hasRunningJob && (
              <div className="mb-4 p-4 bg-sky-500/10 border border-sky-500/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium text-sky-300">RUNNING</p>
                    <p className="text-xs text-slate-400">
                      {runningJob ? getRunJobName(runningJob) : "Processing"}
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
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
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
                    {run.displayLabel} - {formatRunDate(run.createdAt)}
                  </option>
                ))}
              </select>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowRunManagerModal(true)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  Manage Runs
                </button>
                <RunManagementModal
                  projectId={projectId}
                  open={showRunManagerModal}
                  onClose={() => setShowRunManagerModal(false)}
                  onRunsChanged={handleRunsChanged}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={customerDataHref}
                className="inline-block rounded bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
              >
                View Customer Data
              </Link>
              {selectedRunId ? (
                <Link
                  href={adDataHref}
                  className="inline-block rounded bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  View Ad Data
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Select a run to view ad data"
                  className="inline-block cursor-not-allowed rounded bg-slate-900 px-4 py-2 text-sm text-slate-500"
                >
                  View Ad Data
                </button>
              )}
              <Link
                href={productDataHref}
                className="inline-block rounded bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
              >
                View Product Data
              </Link>
            </div>
          </div>
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
                    const customerResearchJob = stepWithStatus.jobType === "CUSTOMER_RESEARCH"
                      ? latestCompletedCustomerResearchJob
                      : undefined;
                    const stepsWithAlwaysHistoryButton = new Set([
                      "customer-research",
                      "customer-analysis",
                      "ad-collection",
                      "ad-ocr",
                      "ad-transcripts",
                      "ad-quality-gate",
                      "pattern-analysis",
                      "product-collection",
                    ]);
                    const showAlwaysHistoryButton = stepsWithAlwaysHistoryButton.has(stepWithStatus.id);
	                    const historyUrl = currentRunId
	                      ? stepWithStatus.label === "Customer Analysis"
	                        ? `/projects/${projectId}/research-hub/jobs/customer-analysis?runId=${currentRunId}`
	                        : `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}?runId=${currentRunId}`
	                      : stepWithStatus.label === "Customer Analysis"
	                        ? `/projects/${projectId}/research-hub/jobs/customer-analysis`
	                        : `/projects/${projectId}/research-hub/jobs/${stepWithStatus.jobType}`;
	                    const payloadRunId = String(stepWithStatus.lastJob?.payload?.runId ?? "").trim();
	                    const stepRunId =
	                      stepWithStatus.lastJob?.runId || payloadRunId || currentRunId || selectedRunId || null;
	                    const stepRawDataHref = stepWithStatus.lastJob
	                      ? `/projects/${projectId}/research/data/${stepWithStatus.lastJob.id}${
	                          stepRunId ? `?runId=${stepRunId}` : ""
	                        }`
	                      : null;
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
                          {stepWithStatus.attemptCount && stepWithStatus.attemptCount > 0 && (
                            <p className="text-[11px] text-slate-500 mb-2">
                              Attempt {stepWithStatus.attemptCount}
                              {stepWithStatus.lastJob?.createdAt
                                ? ` · Last run ${new Date(stepWithStatus.lastJob.createdAt).toLocaleString()}`
                                : ""}
                            </p>
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
                              <div className="flex items-start gap-3">
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-red-300 mb-1">Error Details:</p>
                                  <p className="text-xs text-red-400">{stepWithStatus.lastJob.error}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action Button */}
                        <div className="flex-shrink-0 flex gap-2">
                          {showAlwaysHistoryButton && (
                            <button
                              onClick={() => {
                                router.push(historyUrl);
                              }}
                              className="text-slate-400 hover:text-slate-300 text-xs underline"
                            >
                              {currentRunId ? "View Run History" : "View All History"}
                            </button>
                          )}
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
                            </div>
                          ) : (
	                          stepWithStatus.status === "COMPLETED" && stepWithStatus.lastJob && (
	                            <div className="flex flex-col gap-1">
	                              {stepWithStatus.id === "product-collection" && stepRawDataHref && (
	                                <Link
	                                  href={stepRawDataHref}
	                                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
	                                >
	                                  View Raw Data
	                                </Link>
	                              )}
	                              {stepWithStatus.id === "ad-transcripts" && (
                                <button
                                  onClick={() => {
                                    const payloadRunId = String(stepWithStatus.lastJob?.payload?.runId ?? "").trim();
                                    const runId = stepWithStatus.lastJob?.runId || payloadRunId || currentRunId;
                                    const jobType = stepWithStatus.id === "ad-quality-gate"
                                      ? "ad-quality-gate"
                                      : stepWithStatus.id === "pattern-analysis"
                                        ? "pattern-analysis"
                                        : "ad-transcripts";
                                    const runQuery = runId ? `&runId=${runId}` : "";
                                    router.push(`/projects/${projectId}/research-hub/data?jobType=${jobType}${runQuery}`);
                                  }}
                                  className="px-2 py-1 text-xs text-slate-300 border border-slate-600 rounded hover:border-slate-500 hover:text-slate-200"
                                >
                                  View Data
                                </button>
                              )}
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
                                  Run
                                </button>
                                {(stepWithStatus.id === "ad-collection" ||
                                  stepWithStatus.id === "ad-ocr" ||
                                  stepWithStatus.id === "ad-quality-gate" ||
                                  stepWithStatus.id === "pattern-analysis") &&
                                  stepWithStatus.lastJob && (
                                  <button
                                    onClick={() => handleViewStepData(stepWithStatus)}
                                    className="px-2 py-1 text-xs text-gray-400 hover:text-gray-300 border border-gray-600 rounded"
                                  >
                                    View Data
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="flex gap-2">
                                {!(locked && anyRunning) && (
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
                                  >
                                    {isRunning
                                      ? "Starting..."
                                      : locked
                                        ? "🔒 Locked"
                                        : stepWithStatus.label === "Customer Analysis" && analysisRunning
                                          ? "Running..."
                                          : "Run"}
                                  </button>
                                )}
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
                                projectId={projectId}
                                uploadJobId={stepWithStatus.lastJob?.id ?? null}
                                onClose={() => {
                                  setActiveStepModal(null);
                                  setPendingStep(null);
                                }}
                              />
                            )}
                            {stepWithStatus.id === "product-collection" && (
                              <ProductCollectionModal
                                onSubmit={handleProductCollectionSubmit}
                                projectId={projectId}
                                uploadJobId={stepWithStatus.lastJob?.id ?? null}
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
          {recentResearchJobs.map(job => {
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
    formDataUpload.append("source", "operator_upload");

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
                Run
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
  projectId,
  uploadJobId,
  onClose,
}: {
  onSubmit: (data: AdCollectionFormData) => void;
  projectId: string;
  uploadJobId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "upload">("collect");
  const [industryCode, setIndustryCode] = useState(DEFAULT_MODAL_INDUSTRY_CODE);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedIndustry =
    INDUSTRY_SUGGESTIONS.find((option) => option.code === industryCode) ?? null;
  const filteredIndustries = INDUSTRY_SUGGESTIONS.filter((option) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      option.label.toLowerCase().includes(q) ||
      option.code.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (!isDropdownOpen) return;
    searchInputRef.current?.focus();
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (dropdownRef.current.contains(event.target as Node)) return;
      setIsDropdownOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const normalized = industryCode.trim();
    if (!normalized) {
      setErrorMessage("Please enter an industry code.");
      return;
    }
    onSubmit({ industryCode: normalized });
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
    formDataUpload.append("source", "operator_ad_upload");

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
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-w-lg w-full">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-2">Industry Selection</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your industry code to collect relevant ads or upload your own ad research data
          </p>
          {errorMessage && <p className="text-sm text-red-400 mb-3">{errorMessage}</p>}
          {uploadMessage && <p className="text-sm text-slate-300 mb-3">{uploadMessage}</p>}

          <div className="flex gap-2 mb-6 border-b border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab("collect")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "collect"
                  ? "border-sky-500 text-sky-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Collect Ads
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

          {activeTab === "collect" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Industry Code <span className="text-red-400">*</span>
              </label>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-left text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {selectedIndustry
                    ? `${selectedIndustry.label} (${selectedIndustry.code})`
                    : "Select an industry"}
                </button>

                {isDropdownOpen && (
                  <div className="absolute z-20 mt-2 w-full rounded border border-slate-700 bg-slate-900 shadow-xl">
                    <div className="p-2 border-b border-slate-700">
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        placeholder="Search industry (e.g., Health)"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                      {filteredIndustries.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-slate-400">
                          No matching industries.
                        </p>
                      ) : (
                        filteredIndustries.map((option) => (
                          <button
                            key={option.code}
                            type="button"
                            onClick={() => {
                              setIndustryCode(option.code);
                              setSearchQuery("");
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                              option.code === industryCode
                                ? "bg-slate-800 text-sky-300"
                                : "text-slate-200"
                            }`}
                          >
                            <span>{option.label}</span>
                            <span className="ml-2 text-xs text-slate-400">{option.code}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Search by name or code. All 21 TikTok industry categories are available.
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
                Run
              </button>
            </div>
          </form>
          )}
          {activeTab === "upload" && (
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

// Product Collection Modal Component
function ProductCollectionModal({
  onSubmit,
  projectId,
  uploadJobId,
  formData,
  setFormData,
  onClose,
}: {
  onSubmit: (data: ProductCollectionFormData) => void;
  projectId: string;
  uploadJobId: string | null;
  formData: ProductCollectionFormData;
  setFormData: (next: ProductCollectionFormData) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "upload">("collect");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
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
    formDataUpload.append("source", "operator_product_upload");

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
          <h2 className="text-xl font-bold text-white mb-2">Product Information</h2>
          <p className="text-sm text-slate-400 mb-6">
            Enter your product URL or upload your own product research data
          </p>
          {errorMessage && <p className="text-sm text-red-400 mb-3">{errorMessage}</p>}
          {uploadMessage && <p className="text-sm text-slate-300 mb-3">{uploadMessage}</p>}

          <div className="flex gap-2 mb-6 border-b border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab("collect")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "collect"
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Collect Data
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("upload")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "upload"
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              Upload Data
            </button>
          </div>

          {activeTab === "collect" && (
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
                Run
              </button>
            </div>
          </form>
          )}
          {activeTab === "upload" && (
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
                    file:bg-violet-600 file:text-white
                    hover:file:bg-violet-500"
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
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
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
