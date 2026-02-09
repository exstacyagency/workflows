// app/projects/[projectId]/creative-studio/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { JobStatus, JobType } from "@prisma/client";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";

type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  resultSummary?: string | null;
  error?: string | null;
};

type ProductOption = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
};

type ProductionStep = {
  key: string;
  label: string;
  jobType: JobType;
  status: "not_started" | "running" | "completed" | "failed";
  canRun: boolean;
  locked: boolean;
  lockReason?: string;
  lastJob?: Job;
};

type ResearchQuality = {
  customer: boolean;
  product: boolean;
  ad: boolean;
  score: number; // 0-100
  message: string;
};

export default function CreativeStudioPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params?.projectId as string;
  const selectedProductIdFromUrl = searchParams.get("productId") || searchParams.get("product");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(selectedProductIdFromUrl);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [researchQuality, setResearchQuality] = useState<ResearchQuality>({
    customer: false,
    product: false,
    ad: false,
    score: 0,
    message: "No research completed yet",
  });

  const loadJobs = useCallback(async (productId?: string | null) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      const loadedJobs = Array.isArray(data.jobs) ? data.jobs : [];
      const filteredJobs = productId
        ? loadedJobs.filter((j: any) => String(j?.payload?.productId || "") === productId)
        : [];
      setJobs(filteredJobs);
      setLastRefresh(new Date());
      
      // Calculate research quality
      const customer = filteredJobs.some(
        (j: Job) =>
          j.type === JobType.CUSTOMER_ANALYSIS && j.status === JobStatus.COMPLETED
      );
      const product = false; // Will enable when product research is implemented
      const ad = filteredJobs.some(
        (j: Job) =>
          j.type === JobType.PATTERN_ANALYSIS && j.status === JobStatus.COMPLETED
      );

      const completedTracks = [customer, product, ad].filter(Boolean).length;
      const score = Math.round((completedTracks / 3) * 100);

      let message = "";
      if (score === 0) {
        message = "No research completed. Scripts will use generic templates.";
      } else if (score === 33) {
        message = "Basic research complete. Consider adding more research for better results.";
      } else if (score === 66) {
        message = "Good research foundation. One more track will maximize quality.";
      } else {
        message = "Excellent! All research complete for maximum quality.";
      }

      setResearchQuality({ customer, product, ad, score, message });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadProducts = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/products`, {
        cache: "no-store",
      });
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

      const hasSelected =
        selectedProductIdFromUrl && productList.some((p: ProductOption) => p.id === selectedProductIdFromUrl);
      const nextSelected = hasSelected ? selectedProductIdFromUrl : productList[0].id;
      setSelectedProductId(nextSelected);
      if (!hasSelected) {
        const url = new URL(window.location.href);
        url.searchParams.set("productId", nextSelected);
        url.searchParams.delete("product");
        router.replace(url.pathname + url.search, { scroll: false });
      }
    } catch (err: any) {
      setError(err.message || "Failed to load products");
      setProducts([]);
      setSelectedProductId(null);
    }
  }, [projectId, router, selectedProductIdFromUrl]);

  useEffect(() => {
    if (!projectId) return;
    loadProducts();
  }, [projectId, loadProducts]);

  useEffect(() => {
    if (!projectId) return;
    loadJobs(selectedProductId);
  }, [projectId, loadJobs, selectedProductId]);

  // Auto-refresh jobs every 5 seconds
  useEffect(() => {
    if (!projectId) return;
    
    const interval = setInterval(() => {
      loadJobs(selectedProductId);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [projectId, loadJobs, selectedProductId]);

  function getJobsForType(type: JobType): Job[] {
    return jobs.filter((j) => j.type === type);
  }

  function getStepStatus(type: JobType): ProductionStep["status"] {
    const jobsOfType = getJobsForType(type);
    if (jobsOfType.length === 0) return "not_started";

    const latest = jobsOfType[0];
    if (latest.status === JobStatus.RUNNING) return "running";
    if (latest.status === JobStatus.COMPLETED) return "completed";
    if (latest.status === JobStatus.FAILED) return "failed";
    return "not_started";
  }

  function hasCompletedJob(type: JobType): boolean {
    return jobs.some((j) => j.type === type && j.status === JobStatus.COMPLETED);
  }

  // Build production pipeline with dependencies
  const steps: ProductionStep[] = [
    {
      key: "script",
      label: "Generate Script",
      jobType: JobType.SCRIPT_GENERATION,
      status: getStepStatus(JobType.SCRIPT_GENERATION),
      canRun: true, // Can always run, but quality depends on research
      locked: false,
      lastJob: getJobsForType(JobType.SCRIPT_GENERATION)[0],
    },
    {
      key: "storyboard",
      label: "Create Storyboard",
      jobType: JobType.STORYBOARD_GENERATION,
      status: getStepStatus(JobType.STORYBOARD_GENERATION),
      canRun: hasCompletedJob(JobType.SCRIPT_GENERATION),
      locked: !hasCompletedJob(JobType.SCRIPT_GENERATION),
      lockReason: "Generate script first",
      lastJob: getJobsForType(JobType.STORYBOARD_GENERATION)[0],
    },
    {
      key: "video_prompts",
      label: "Generate Video Prompts",
      jobType: JobType.VIDEO_PROMPT_GENERATION,
      status: getStepStatus(JobType.VIDEO_PROMPT_GENERATION),
      canRun: hasCompletedJob(JobType.STORYBOARD_GENERATION),
      locked: !hasCompletedJob(JobType.STORYBOARD_GENERATION),
      lockReason: "Create storyboard first",
      lastJob: getJobsForType(JobType.VIDEO_PROMPT_GENERATION)[0],
    },
    {
      key: "video_images",
      label: "Generate Images",
      jobType: JobType.VIDEO_IMAGE_GENERATION,
      status: getStepStatus(JobType.VIDEO_IMAGE_GENERATION),
      canRun: hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      lockReason: "Generate prompts first",
      lastJob: getJobsForType(JobType.VIDEO_IMAGE_GENERATION)[0],
    },
    {
      key: "video",
      label: "Generate Video",
      jobType: JobType.VIDEO_GENERATION,
      status: getStepStatus(JobType.VIDEO_GENERATION),
      canRun: hasCompletedJob(JobType.VIDEO_IMAGE_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_IMAGE_GENERATION),
      lockReason: "Generate images first",
      lastJob: getJobsForType(JobType.VIDEO_GENERATION)[0],
    },
    {
      key: "review",
      label: "Review Video",
      jobType: JobType.VIDEO_REVIEW,
      status: getStepStatus(JobType.VIDEO_REVIEW),
      canRun: hasCompletedJob(JobType.VIDEO_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_GENERATION),
      lockReason: "Generate video first",
      lastJob: getJobsForType(JobType.VIDEO_REVIEW)[0],
    },
    {
      key: "upscale",
      label: "Upscale & Export",
      jobType: JobType.VIDEO_UPSCALER,
      status: getStepStatus(JobType.VIDEO_UPSCALER),
      canRun: hasCompletedJob(JobType.VIDEO_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_GENERATION),
      lockReason: "Generate video first",
      lastJob: getJobsForType(JobType.VIDEO_UPSCALER)[0],
    },
  ];

  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = steps.length;

  async function runStep(step: ProductionStep) {
    if (!step.canRun || step.locked) return;
    if (!selectedProductId) {
      setError("Select or create a product first.");
      return;
    }

    setSubmitting(step.key);
    setError(null);

    try {
      let endpoint = "";
      let payload: any = { projectId, productId: selectedProductId };

      // Map steps to their API endpoints
      const endpointMap: Record<string, string> = {
        script: "/api/jobs/script-generation",
        storyboard: "/api/jobs/storyboard-generation",
        video_prompts: "/api/jobs/video-prompts",
        video_images: "/api/jobs/video-images",
        video: "/api/jobs/video-generation",
        review: "/api/jobs/video-reviewer",
        upscale: "/api/jobs/video-upscaler",
      };

      endpoint = endpointMap[step.key];

      if (!endpoint) {
        throw new Error("Endpoint not configured for this step");
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      const data = await res.json();
      console.log("[Creative] Job created:", data.jobId);

      // Reload jobs
      await loadJobs(selectedProductId);
      toast.success("Job started successfully!");
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message || "Failed to start job");
    } finally {
      setSubmitting(null);
    }
  }

  async function runAllAvailable() {
    // Find the next unlocked step
    const nextStep = steps.find((s) => s.canRun && !s.locked && s.status !== "completed");
    if (nextStep) {
      await runStep(nextStep);
    }
  }

  function Spinner() {
    return (
      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
      </svg>
    );
  }

  function getStepBadge(status: ProductionStep["status"]) {
    const badges = {
      not_started: "bg-slate-800 text-slate-400",
      running: "bg-sky-500/20 text-sky-300 border border-sky-500/50",
      completed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50",
      failed: "bg-red-500/20 text-red-300 border border-red-500/50",
    };
    const labels = {
      not_started: "Not Started",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badges[status]}`}>
        {labels[status]}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-slate-400">Loading creative studio...</p>
      </div>
    );
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  return (
    <div className="px-6 py-6 space-y-6 max-w-4xl">
      {/* Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-slate-50">Creative Studio</h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-sm text-slate-300">
                Transform your research into high-quality video ads through our automated production pipeline.
              </p>
              {lastRefresh && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                  </span>
                  <span>
                    Updated {Math.floor((new Date().getTime() - lastRefresh.getTime()) / 1000)}s ago
                  </span>
                </div>
              )}
            </div>
            {products.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3 max-w-sm">
                <div className="text-xs text-slate-500 mb-1">Current Product</div>
                <div className="text-sm font-medium text-slate-100 mb-2">
                  {selectedProduct ? selectedProduct.name : "Select a product"}
                </div>
                <select
                  value={selectedProductId || ""}
                  onChange={(e) => {
                    const nextProductId = e.target.value;
                    setSelectedProductId(nextProductId);
                    const url = new URL(window.location.href);
                    url.searchParams.set("productId", nextProductId);
                    url.searchParams.delete("product");
                    router.replace(url.pathname + url.search, { scroll: false });
                  }}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300"
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
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-slate-50">
              {Math.round((completedSteps / totalSteps) * 100)}%
            </div>
            <div className="text-xs text-slate-400">
              {completedSteps} of {totalSteps} steps
            </div>
          </div>
        </div>
      </section>

      {/* Research Quality Score */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-100">Research Foundation</h2>
          <span className="text-2xl font-bold text-slate-50">{researchQuality.score}%</span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className={`rounded-lg border p-3 ${researchQuality.customer ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700 bg-slate-800/50"}`}>
            <div className="text-xs text-slate-400 mb-1">Customer</div>
            <div className="text-sm font-medium text-slate-50">
              {researchQuality.customer ? "✓ Complete" : "Not Started"}
            </div>
          </div>
          <div className={`rounded-lg border p-3 ${researchQuality.product ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700 bg-slate-800/50"}`}>
            <div className="text-xs text-slate-400 mb-1">Product</div>
            <div className="text-sm font-medium text-slate-50">
              {researchQuality.product ? "✓ Complete" : "Coming Soon"}
            </div>
          </div>
          <div className={`rounded-lg border p-3 ${researchQuality.ad ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700 bg-slate-800/50"}`}>
            <div className="text-xs text-slate-400 mb-1">Ad Patterns</div>
            <div className="text-sm font-medium text-slate-50">
              {researchQuality.ad ? "✓ Complete" : "Not Started"}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">{researchQuality.message}</p>

        {researchQuality.score < 100 && (
          <button
            onClick={() =>
              router.push(
                selectedProductId
                  ? `/projects/${projectId}/research-hub?productId=${selectedProductId}`
                  : `/projects/${projectId}/research-hub`
              )
            }
            className="mt-3 text-xs text-sky-400 hover:text-sky-300 underline"
          >
            Add more research →
          </button>
        )}
      </section>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/50 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Production Pipeline */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-50">Production Pipeline</h2>
          <button
            onClick={runAllAvailable}
            disabled={!steps.some((s) => s.canRun && !s.locked && s.status !== "completed")}
            className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
          >
            Run Next Step
          </button>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.key}>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-400">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-medium text-slate-50">{step.label}</p>
                        {getStepBadge(step.status)}
                      </div>
                      {step.locked && (
                        <p className="text-xs text-slate-500">🔒 {step.lockReason}</p>
                      )}
                      {step.lastJob && step.status !== "failed" && step.status !== "running" && (
                        <p className="text-xs text-slate-400">
                          {step.lastJob.resultSummary || "Job completed"}
                        </p>
                      )}
                      {step.status === "running" && (
                        <div className="mt-3 flex items-center gap-2 text-sky-400">
                          <Spinner />
                          <span className="text-xs">Processing...</span>
                        </div>
                      )}
                      {step.status === "failed" && step.lastJob?.error && (
                        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-red-300 mb-1">Error Details:</p>
                              <p className="text-xs text-red-400">{step.lastJob.error}</p>
                            </div>
                            <button
                              onClick={() => runStep(step)}
                              className="text-xs text-red-400 hover:text-red-300 underline whitespace-nowrap"
                            >
                              Try again →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => runStep(step)}
                    disabled={
                      !step.canRun ||
                      step.locked ||
                      step.status === "running" ||
                      submitting === step.key
                    }
                    className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors whitespace-nowrap flex items-center gap-2"
                  >
                    {submitting === step.key && <Spinner />}
                    {submitting === step.key
                      ? "Starting..."
                      : step.status === "completed"
                        ? "Re-run"
                        : step.status === "running"
                          ? "Running"
                          : "Run"}
                  </button>
                </div>
              </div>

              {index < steps.length - 1 && (
                <div className="flex justify-center py-2">
                  <div className="w-0.5 h-4 bg-slate-700" />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Info */}
      <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">How It Works</h3>
        <div className="space-y-2 text-xs text-slate-400">
          <p>• Each step must complete before the next one unlocks</p>
          <p>• Research data automatically informs script generation</p>
          <p>• You can re-run any step to generate alternatives</p>
          <p>• Final video will be available in the Scripts & Media section</p>
        </div>
      </section>
      <Toaster position="top-right" />
    </div>
  );
}
