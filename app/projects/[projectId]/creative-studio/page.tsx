// app/projects/[projectId]/creative-studio/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStatus, JobType } from "@prisma/client";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";

type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  resultSummary?: unknown;
  error?: unknown;
  runId?: string | null;
  payload?: Record<string, unknown> | null;
};

type ProductOption = {
  id: string;
  name: string;
  productProblemSolved?: string | null;
  amazonAsin?: string | null;
};

type ResearchRunOption = {
  jobId: string;
  runId?: string | null;
  createdAt: string;
  updatedAt?: string;
  summary?: string | null;
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

type ScriptResearchSources = {
  customerAnalysisRunDate?: string | null;
  patternAnalysisRunDate?: string | null;
  productIntelDate?: string | null;
};

type ScriptBeat = {
  beat: string;
  duration: string | number | null;
  vo: string;
};

type ScriptDetails = {
  id: string;
  status: string;
  rawJson: unknown;
  wordCount: number | null;
  createdAt: string;
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptModalMode, setScriptModalMode] = useState<"choose" | "ai" | "upload">("choose");
  const [scriptUploadText, setScriptUploadText] = useState("");
  const [scriptResearchRuns, setScriptResearchRuns] = useState<ResearchRunOption[]>([]);
  const [scriptRunsLoading, setScriptRunsLoading] = useState(false);
  const [selectedScriptResearchJobId, setSelectedScriptResearchJobId] = useState("");
  const [scriptNoResearchAcknowledged, setScriptNoResearchAcknowledged] = useState(false);
  const [scriptModalSubmitting, setScriptModalSubmitting] = useState(false);
  const [scriptModalError, setScriptModalError] = useState<string | null>(null);
  const [scriptPanelOpenId, setScriptPanelOpenId] = useState<string | null>(null);
  const [scriptPanelLoading, setScriptPanelLoading] = useState(false);
  const [scriptPanelError, setScriptPanelError] = useState<string | null>(null);
  const [scriptPanelData, setScriptPanelData] = useState<ScriptDetails | null>(null);
  const [scriptPanelEditMode, setScriptPanelEditMode] = useState(false);
  const [scriptPanelDraftBeats, setScriptPanelDraftBeats] = useState<ScriptBeat[]>([]);
  const [scriptPanelSaving, setScriptPanelSaving] = useState(false);
  const selectedProductRef = useRef<string | null>(selectedProductIdFromUrl);
  const hasInitializedRunSelection = useRef(false);

  useEffect(() => {
    selectedProductRef.current = selectedProductId;
  }, [selectedProductId]);

  const loadJobs = useCallback(async (productId?: string | null) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      const loadedJobs = Array.isArray(data.jobs) ? data.jobs : [];
      const productToFilter = (productId ?? selectedProductRef.current) || null;
      const filteredJobs = loadedJobs.filter((j: Job) => {
        if (!productToFilter) return true;
        const jobProductId = String(j?.payload?.productId || "").trim();
        // Keep project-level jobs (no productId), plus selected product jobs.
        return !jobProductId || jobProductId === String(productToFilter);
      });
      setJobs(filteredJobs);
      setLastRefresh(new Date());
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

  const runGroups = useMemo(
    () =>
      jobs.reduce<Record<string, { runId: string; createdAt: string; jobs: Job[] }>>(
        (acc, job) => {
          const runId = job.runId ?? job.id;
          if (!acc[runId]) {
            acc[runId] = { runId, createdAt: job.createdAt, jobs: [] };
          }
          acc[runId].jobs.push(job);
          if (new Date(job.createdAt).getTime() > new Date(acc[runId].createdAt).getTime()) {
            acc[runId].createdAt = job.createdAt;
          }
          return acc;
        },
        {}
      ),
    [jobs]
  );

  const runGroupsList = useMemo(() => Object.values(runGroups), [runGroups]);

  function getRunJobName(job: Job) {
    const names: Record<JobType, string> = {
      SCRIPT_GENERATION: "Generate Script",
      STORYBOARD_GENERATION: "Create Storyboard",
      VIDEO_PROMPT_GENERATION: "Generate Video Prompts",
      VIDEO_IMAGE_GENERATION: "Generate Images",
      VIDEO_GENERATION: "Generate Video",
      VIDEO_REVIEW: "Review Video",
      VIDEO_UPSCALER: "Upscale & Export",
      CUSTOMER_RESEARCH: "Customer Research",
      CUSTOMER_ANALYSIS: "Customer Analysis",
      AD_PERFORMANCE: "Ad Collection",
      AD_QUALITY_GATE: "Quality Assessment",
      PATTERN_ANALYSIS: "Pattern Analysis",
      PRODUCT_DATA_COLLECTION: "Product Collection",
      PRODUCT_ANALYSIS: "Product Analysis",
    };
    return names[job.type] || job.type;
  }

  const runNumberByRunId = useMemo(
    () =>
      new Map(
        [...runGroupsList]
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((run, index) => [run.runId, index + 1] as const)
      ),
    [runGroupsList]
  );

  const sortedRuns = useMemo(
    () =>
      [...runGroupsList]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((run) => {
          const completedJobs = run.jobs
            .filter((j) => j.status === JobStatus.COMPLETED)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const lastJob = completedJobs[0];
          const runNumber = runNumberByRunId.get(run.runId) ?? 0;
          const lastJobName = lastJob ? getRunJobName(lastJob) : "No jobs";
          return {
            ...run,
            runNumber,
            displayLabel: `Run #${runNumber} - Last: ${lastJobName} ✓`,
            jobCount: run.jobs.length,
          };
        }),
    [runGroupsList, runNumberByRunId]
  );

  useEffect(() => {
    if (sortedRuns.length === 0) {
      setSelectedRunId(null);
      hasInitializedRunSelection.current = false;
      return;
    }
    if (!hasInitializedRunSelection.current) {
      hasInitializedRunSelection.current = true;
      setSelectedRunId(sortedRuns[0].runId);
      return;
    }
    if (selectedRunId && !sortedRuns.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId(sortedRuns[0].runId);
    }
  }, [selectedRunId, sortedRuns]);

  const selectedRun = selectedRunId ? sortedRuns.find((run) => run.runId === selectedRunId) : null;
  const selectedRunJobs = selectedRun?.jobs ?? [];
  const hasSelectedRunWithJobs = Boolean(selectedRunId && selectedRunJobs.length > 0);
  const jobsInActiveRun = hasSelectedRunWithJobs ? selectedRunJobs : [];

  useEffect(() => {
    closeScriptPanel();
  }, [selectedRunId]);

  const formatRunDate = (dateString: string) =>
    new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  function getSummaryText(resultSummary: unknown): string {
    if (typeof resultSummary === "string" && resultSummary.trim()) {
      return resultSummary;
    }
    if (resultSummary && typeof resultSummary === "object") {
      const summaryField = (resultSummary as Record<string, unknown>).summary;
      if (typeof summaryField === "string" && summaryField.trim()) {
        return summaryField;
      }
    }
    return "Job completed";
  }

  function getScriptResearchSources(resultSummary: unknown): ScriptResearchSources | null {
    if (!resultSummary || typeof resultSummary !== "object") return null;
    const metadata = (resultSummary as Record<string, unknown>).researchSources;
    if (!metadata || typeof metadata !== "object") return null;
    return metadata as ScriptResearchSources;
  }

  function formatMetadataDate(value: string | null | undefined): string {
    if (!value) return "Not available";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  function getErrorText(errorValue: unknown): string {
    if (typeof errorValue === "string" && errorValue.trim()) {
      return errorValue;
    }
    if (errorValue == null) return "Unknown error";
    try {
      return JSON.stringify(errorValue);
    } catch {
      return String(errorValue);
    }
  }

  function getScriptIdFromResultSummary(resultSummary: unknown): string | null {
    if (resultSummary && typeof resultSummary === "object") {
      const scriptId = (resultSummary as Record<string, unknown>).scriptId;
      if (typeof scriptId === "string" && scriptId.trim()) {
        return scriptId.trim();
      }
      const summaryText = (resultSummary as Record<string, unknown>).summary;
      if (typeof summaryText === "string") {
        const match = summaryText.match(/scriptId=([^) ,]+)/);
        if (match?.[1]) return match[1];
      }
    }
    if (typeof resultSummary === "string") {
      const match = resultSummary.match(/scriptId=([^) ,]+)/);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  function extractScriptBeats(rawJson: unknown): ScriptBeat[] {
    if (!rawJson || typeof rawJson !== "object") return [];
    const rawScenes = (rawJson as Record<string, unknown>).scenes;
    if (!Array.isArray(rawScenes)) return [];

    return rawScenes.map((scene, index) => {
      const parsed = scene && typeof scene === "object" ? (scene as Record<string, unknown>) : {};
      const beatValue = parsed.beat;
      const voValue = parsed.vo;
      const durationValue = parsed.duration;
      return {
        beat:
          typeof beatValue === "string" && beatValue.trim()
            ? beatValue.trim()
            : `Beat ${index + 1}`,
        duration:
          typeof durationValue === "number" || typeof durationValue === "string"
            ? durationValue
            : null,
        vo: typeof voValue === "string" ? voValue : "",
      };
    });
  }

  async function loadScriptPanel(scriptId: string) {
    setScriptPanelOpenId(scriptId);
    setScriptPanelLoading(true);
    setScriptPanelError(null);
    setScriptPanelEditMode(false);

    try {
      const res = await fetch(`/api/projects/${projectId}/scripts/${scriptId}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load script");
      }

      const script = data as ScriptDetails;
      const beats = extractScriptBeats(script.rawJson);
      setScriptPanelData(script);
      setScriptPanelDraftBeats(beats);
    } catch (err: any) {
      setScriptPanelData(null);
      setScriptPanelDraftBeats([]);
      setScriptPanelError(err?.message || "Failed to load script");
    } finally {
      setScriptPanelLoading(false);
    }
  }

  function closeScriptPanel() {
    setScriptPanelOpenId(null);
    setScriptPanelLoading(false);
    setScriptPanelError(null);
    setScriptPanelData(null);
    setScriptPanelEditMode(false);
    setScriptPanelDraftBeats([]);
    setScriptPanelSaving(false);
  }

  async function handleSaveScriptPanelEdits() {
    if (!scriptPanelOpenId) return;

    setScriptPanelSaving(true);
    setScriptPanelError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/scripts/${scriptPanelOpenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: scriptPanelDraftBeats,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save script");
      }

      const updatedScript = (data?.script ?? data) as ScriptDetails;
      setScriptPanelData(updatedScript);
      setScriptPanelDraftBeats(extractScriptBeats(updatedScript.rawJson));
      setScriptPanelEditMode(false);
      toast.success("Script updated.");
    } catch (err: any) {
      setScriptPanelError(err?.message || "Failed to save script");
      toast.error(err?.message || "Failed to save script");
    } finally {
      setScriptPanelSaving(false);
    }
  }

  function getJobsForType(type: JobType): Job[] {
    return jobsInActiveRun.filter((j) => j.type === type);
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
    return jobsInActiveRun.some((j) => j.type === type && j.status === JobStatus.COMPLETED);
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

  async function runStep(
    step: ProductionStep,
    extraPayload?: Record<string, unknown>
  ): Promise<boolean> {
    if (!step.canRun || step.locked) return false;
    if (!selectedProductId) {
      setError("Select or create a product first.");
      return false;
    }

    setSubmitting(step.key);
    setError(null);

    try {
      let endpoint = "";
      let payload: any = {
        projectId,
        productId: selectedProductId,
        ...(extraPayload || {}),
      };

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
      return true;
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message || "Failed to start job");
      return false;
    } finally {
      setSubmitting(null);
    }
  }

  function resetScriptModal() {
    setScriptModalMode("choose");
    setScriptUploadText("");
    setScriptResearchRuns([]);
    setScriptRunsLoading(false);
    setSelectedScriptResearchJobId("");
    setScriptNoResearchAcknowledged(false);
    setScriptModalError(null);
    setScriptModalSubmitting(false);
  }

  function handleStepRunClick(step: ProductionStep) {
    if (step.key === "script") {
      resetScriptModal();
      setShowScriptModal(true);
      return;
    }
    void runStep(step);
  }

  async function loadScriptResearchRuns(): Promise<ResearchRunOption[]> {
    const res = await fetch(`/api/projects/${projectId}/research-runs`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to load research runs");
    }
    return Array.isArray(data.runs) ? data.runs : [];
  }

  async function handleChooseGenerateWithAi() {
    setScriptModalMode("ai");
    setScriptModalError(null);
    setScriptRunsLoading(true);

    try {
      const runs = await loadScriptResearchRuns();
      setScriptResearchRuns(runs);
      setSelectedScriptResearchJobId(runs[0]?.jobId || "");
      setScriptNoResearchAcknowledged(false);
    } catch (err: any) {
      setScriptResearchRuns([]);
      setSelectedScriptResearchJobId("");
      setScriptNoResearchAcknowledged(false);
      setScriptModalError(err?.message || "Failed to load research runs");
    } finally {
      setScriptRunsLoading(false);
    }
  }

  async function handleGenerateScriptWithAi() {
    const scriptStep = steps.find((step) => step.key === "script");
    if (!scriptStep) return;
    const hasResearchRuns = scriptResearchRuns.length > 0;
    if (hasResearchRuns && !selectedScriptResearchJobId) {
      setScriptModalError("Select a completed research run before generating.");
      return;
    }
    if (!hasResearchRuns && !scriptNoResearchAcknowledged) {
      setScriptModalError("Please acknowledge the generic script warning before generating.");
      return;
    }

    setScriptModalSubmitting(true);
    setScriptModalError(null);
    const ok = await runStep(
      scriptStep,
      selectedScriptResearchJobId
        ? { customerAnalysisJobId: selectedScriptResearchJobId }
        : undefined
    );
    setScriptModalSubmitting(false);

    if (ok) {
      setShowScriptModal(false);
      resetScriptModal();
    }
  }

  async function handleUploadScript() {
    const text = scriptUploadText.trim();
    if (!text) {
      setScriptModalError("Please paste your script before uploading.");
      return;
    }

    if (!selectedProductId) {
      setScriptModalError("Select or create a product first.");
      return;
    }

    setScriptModalSubmitting(true);
    setScriptModalError(null);

    try {
      const res = await fetch("/api/jobs/script-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productId: selectedProductId,
          scriptText: text,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      await loadJobs(selectedProductId);
      toast.success("Script uploaded successfully.");
      setShowScriptModal(false);
      resetScriptModal();
    } catch (err: any) {
      setScriptModalError(err?.message || "Failed to upload script");
      toast.error(err?.message || "Failed to upload script");
    } finally {
      setScriptModalSubmitting(false);
    }
  }

  function Spinner() {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }}
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} />
        <path
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          style={{ opacity: 0.75 }}
        />
      </svg>
    );
  }

  function getStepBadge(status: ProductionStep["status"]) {
    const badgeStyles: Record<ProductionStep["status"], React.CSSProperties> = {
      not_started: {
        backgroundColor: "#1e293b",
        color: "#94a3b8",
      },
      running: {
        backgroundColor: "rgba(14, 165, 233, 0.2)",
        color: "#7dd3fc",
        border: "1px solid rgba(14, 165, 233, 0.5)",
      },
      completed: {
        backgroundColor: "rgba(16, 185, 129, 0.2)",
        color: "#6ee7b7",
        border: "1px solid rgba(16, 185, 129, 0.5)",
      },
      failed: {
        backgroundColor: "rgba(239, 68, 68, 0.2)",
        color: "#fca5a5",
        border: "1px solid rgba(239, 68, 68, 0.5)",
      },
    };
    const labels = {
      not_started: "Not Started",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
    };
    return (
      <span
        style={{
          padding: "2px 8px",
          borderRadius: 9999,
          fontSize: 11,
          fontWeight: 600,
          ...badgeStyles[status],
        }}
      >
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
              {sortedRuns.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>No runs yet</span>
                </div>
              )}
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
        </div>
      </section>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/50 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100">Creative Runs</h2>
          <span className="text-xs text-slate-500">
            {sortedRuns.length} {sortedRuns.length === 1 ? "run" : "runs"}
          </span>
        </div>

        <select
          value={selectedRunId || "no-active"}
          onChange={(e) => {
            const value = e.target.value === "no-active" ? null : e.target.value;
            setSelectedRunId(value);
          }}
          className="w-full md:w-auto px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300"
        >
          <option value="no-active">No active run</option>
          {sortedRuns.map((run) => (
            <option key={run.runId} value={run.runId}>
              {run.displayLabel} - {formatRunDate(run.createdAt)}
            </option>
          ))}
        </select>

        {selectedRun && (
          <div className="mt-3 text-sm text-slate-400">
            <div className="text-slate-400">Jobs in this run:</div>
            <div className="mt-2 space-y-1">
              {selectedRun.jobs
                .slice()
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((job) => {
                  const statusIcon =
                    job.status === JobStatus.COMPLETED
                      ? "✓"
                      : job.status === JobStatus.FAILED
                        ? "✕"
                        : job.status === JobStatus.RUNNING
                          ? "●"
                          : "○";
                  return (
                    <div key={job.id} className="flex items-center gap-2">
                      <span className="text-slate-300">{statusIcon}</span>
                      <span>{getRunJobName(job)}</span>
                      <span className="text-xs text-slate-500">
                        {job.status === JobStatus.COMPLETED
                          ? new Date(job.createdAt).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : String(job.status).toLowerCase()}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </section>

      {/* Production Pipeline */}
      <section
        style={{
          backgroundColor: "#0b1220",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "#f8fafc", margin: 0 }}>Production Pipeline</h2>
        </div>

        {!hasSelectedRunWithJobs ? (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid #334155",
              backgroundColor: "#0f172a",
              padding: 20,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: "#cbd5e1", fontWeight: 600 }}>No active run selected</p>
            <p style={{ margin: "8px 0 0 0", fontSize: 13, color: "#94a3b8" }}>
              Select a run to view job status and error details, or start a new run from script generation.
            </p>
            <button
              type="button"
              onClick={() => handleStepRunClick(steps[0])}
              style={{
                marginTop: 14,
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                backgroundColor: "#0ea5e9",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Start with Generate Script
            </button>
          </div>
        ) : (
        <div>
          {steps.map((step, index) => {
            const scriptSources =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptResearchSources(step.lastJob.resultSummary)
                : null;
            const scriptId =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptIdFromResultSummary(step.lastJob.resultSummary)
                : null;
            const isScriptPanelOpen = Boolean(scriptId && scriptPanelOpenId === scriptId);
            return (
            <div
              key={step.key}
              style={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9999,
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#cbd5e1",
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#f1f5f9",
                    }}
                  >
                    {step.label}
                  </p>
                </div>
                <div style={{ minWidth: 120, display: "flex", justifyContent: "center" }}>
                  {getStepBadge(step.status)}
                </div>
                <div style={{ minWidth: 130, display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => handleStepRunClick(step)}
                    disabled={
                      !step.canRun ||
                      step.locked ||
                      step.status === "running" ||
                      submitting === step.key
                    }
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "none",
                      backgroundColor:
                        !step.canRun || step.locked || step.status === "running" || submitting === step.key
                          ? "#1e293b"
                          : "#0ea5e9",
                      color:
                        !step.canRun || step.locked || step.status === "running" || submitting === step.key
                          ? "#64748b"
                          : "#ffffff",
                      cursor:
                        !step.canRun || step.locked || step.status === "running" || submitting === step.key
                          ? "not-allowed"
                          : "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      whiteSpace: "nowrap",
                    }}
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

              {step.locked && (
                <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#64748b" }}>🔒 {step.lockReason}</p>
              )}

              {step.lastJob && step.status !== "failed" && step.status !== "running" && (
                <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#94a3b8" }}>
                  {getSummaryText(step.lastJob.resultSummary)}
                </p>
              )}

              {step.key === "script" && step.status === "completed" && scriptId && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isScriptPanelOpen) {
                        closeScriptPanel();
                      } else {
                        void loadScriptPanel(scriptId);
                      }
                    }}
                    style={{
                      border: "1px solid #334155",
                      backgroundColor: "#0b1220",
                      color: "#cbd5e1",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isScriptPanelOpen ? "Hide Script" : "View/Edit Script"}
                  </button>
                </div>
              )}

              {step.key === "script" && step.status === "completed" && isScriptPanelOpen && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    padding: 12,
                  }}
                >
                  {scriptPanelLoading ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Loading script...</p>
                  ) : scriptPanelError ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{scriptPanelError}</p>
                  ) : scriptPanelData ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div style={{ color: "#94a3b8", fontSize: 12 }}>
                          <div>Script ID: {scriptPanelData.id}</div>
                          <div>
                            Words: {scriptPanelData.wordCount ?? "unknown"} • Created:{" "}
                            {new Date(scriptPanelData.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            })}
                          </div>
                        </div>
                        {!scriptPanelEditMode ? (
                          <button
                            type="button"
                            onClick={() => {
                              setScriptPanelDraftBeats(extractScriptBeats(scriptPanelData.rawJson));
                              setScriptPanelEditMode(true);
                              setScriptPanelError(null);
                            }}
                            style={{
                              border: "1px solid #334155",
                              backgroundColor: "#0f172a",
                              color: "#cbd5e1",
                              padding: "6px 10px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setScriptPanelDraftBeats(extractScriptBeats(scriptPanelData.rawJson));
                                setScriptPanelEditMode(false);
                                setScriptPanelError(null);
                              }}
                              disabled={scriptPanelSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: scriptPanelSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveScriptPanelEdits()}
                              disabled={scriptPanelSaving}
                              style={{
                                border: "none",
                                backgroundColor: scriptPanelSaving ? "#1e293b" : "#0ea5e9",
                                color: scriptPanelSaving ? "#64748b" : "#ffffff",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: scriptPanelSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              {scriptPanelSaving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {(scriptPanelEditMode ? scriptPanelDraftBeats : extractScriptBeats(scriptPanelData.rawJson)).map(
                          (scene, sceneIndex) => (
                            <div
                              key={`${scene.beat}-${sceneIndex}`}
                              style={{
                                border: "1px solid #334155",
                                borderRadius: 8,
                                backgroundColor: "#0b1220",
                                padding: 10,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}
                              >
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                                  {scene.beat}
                                </p>
                                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                                  {scene.duration != null && String(scene.duration).trim() !== ""
                                    ? `${scene.duration}s`
                                    : "No timing"}
                                </span>
                              </div>
                              {scriptPanelEditMode ? (
                                <textarea
                                  value={scene.vo}
                                  onChange={(e) =>
                                    setScriptPanelDraftBeats((prev) =>
                                      prev.map((beat, idx) =>
                                        idx === sceneIndex ? { ...beat, vo: e.target.value } : beat
                                      )
                                    )
                                  }
                                  rows={4}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    borderRadius: 8,
                                    border: "1px solid #334155",
                                    backgroundColor: "#0f172a",
                                    color: "#e2e8f0",
                                    padding: 10,
                                    fontSize: 13,
                                    resize: "vertical",
                                  }}
                                />
                              ) : (
                                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                                  {scene.vo || "No spoken words"}
                                </p>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>No script data available.</p>
                  )}
                </div>
              )}

              {scriptSources && (
                <details
                  style={{
                    marginTop: 10,
                    borderRadius: 8,
                    border: "1px solid #334155",
                    backgroundColor: "#0b1220",
                    padding: "8px 10px",
                  }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      color: "#cbd5e1",
                      fontSize: 12,
                      fontWeight: 600,
                      userSelect: "none",
                    }}
                  >
                    Research sources used
                  </summary>
                  <div
                    style={{
                      marginTop: 8,
                      color: "#94a3b8",
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    <div>Customer analysis run: {formatMetadataDate(scriptSources.customerAnalysisRunDate)}</div>
                    <div>Pattern analysis run: {formatMetadataDate(scriptSources.patternAnalysisRunDate)}</div>
                    <div>Product intel: {formatMetadataDate(scriptSources.productIntelDate)}</div>
                  </div>
                </details>
              )}

              {step.status === "running" && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, color: "#7dd3fc" }}>
                  <Spinner />
                  <span style={{ fontSize: 12 }}>Processing...</span>
                </div>
              )}

              {hasSelectedRunWithJobs && step.status === "failed" && step.lastJob?.error && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 8,
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#fca5a5", margin: "0 0 4px 0" }}>Error Details:</p>
                      <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{getErrorText(step.lastJob.error)}</p>
                    </div>
                    <button
                      onClick={() => handleStepRunClick(step)}
                      style={{
                        fontSize: 12,
                        color: "#f87171",
                        textDecoration: "underline",
                        whiteSpace: "nowrap",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Try again →
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
        )}
      </section>

      {showScriptModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(2, 6, 23, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 720,
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#f8fafc" }}>Generate Script</h3>
              <button
                type="button"
                onClick={() => {
                  if (scriptModalSubmitting) return;
                  setShowScriptModal(false);
                  resetScriptModal();
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {scriptModalMode === "choose" ? (
              <div>
                <p style={{ margin: "0 0 16px 0", color: "#cbd5e1", fontSize: 14 }}>
                  Choose how you want to create this script.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <button
                    type="button"
                    onClick={handleChooseGenerateWithAi}
                    disabled={scriptModalSubmitting}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid #334155",
                      backgroundColor: "#1e293b",
                      color: "#f8fafc",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Generate with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScriptModalMode("upload");
                      setScriptModalError(null);
                    }}
                    disabled={scriptModalSubmitting}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid #334155",
                      backgroundColor: "#0b1220",
                      color: "#e2e8f0",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Upload My Own Script
                  </button>
                </div>
              </div>
            ) : scriptModalMode === "ai" ? (
              <div>
                <p style={{ margin: "0 0 12px 0", color: "#cbd5e1", fontSize: 14 }}>
                  Choose which completed research run should power script generation.
                </p>
                {scriptRunsLoading ? (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Loading completed research runs...</p>
                ) : (
                  <div>
                    {scriptResearchRuns.length === 0 ? (
                      <div>
                        <div
                          style={{
                            borderRadius: 10,
                            border: "1px solid rgba(234, 179, 8, 0.5)",
                            backgroundColor: "rgba(234, 179, 8, 0.1)",
                            color: "#fde68a",
                            padding: "10px 12px",
                            fontSize: 13,
                          }}
                        >
                          No research data found. Script will be generic and not tailored to your customer insights.
                        </div>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 10,
                            color: "#f1f5f9",
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={scriptNoResearchAcknowledged}
                            onChange={(e) => setScriptNoResearchAcknowledged(e.target.checked)}
                            disabled={scriptModalSubmitting}
                          />
                          I understand and want to generate a generic script.
                        </label>
                      </div>
                    ) : (
                      <>
                        <select
                          value={selectedScriptResearchJobId}
                          onChange={(e) => setSelectedScriptResearchJobId(e.target.value)}
                          disabled={scriptModalSubmitting}
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid #334155",
                            backgroundColor: "#020617",
                            color: "#e2e8f0",
                            padding: "10px 12px",
                            fontSize: 14,
                            boxSizing: "border-box",
                          }}
                        >
                          {scriptResearchRuns.map((run) => {
                            const timestamp = new Date(run.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            });
                            return (
                              <option key={run.jobId} value={run.jobId}>
                                {timestamp}
                                {run.runId ? ` • Run ${run.runId}` : ""}
                              </option>
                            );
                          })}
                        </select>
                        {selectedScriptResearchJobId && (
                          <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: 12 }}>
                            Selected analysis job: {selectedScriptResearchJobId}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (scriptModalSubmitting) return;
                      setScriptModalMode("choose");
                      setScriptModalError(null);
                    }}
                    style={{
                      border: "1px solid #334155",
                      backgroundColor: "#0b1220",
                      color: "#cbd5e1",
                      padding: "8px 12px",
                      borderRadius: 8,
                      cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateScriptWithAi}
                    disabled={
                      scriptModalSubmitting ||
                      scriptRunsLoading ||
                      (scriptResearchRuns.length > 0
                        ? !selectedScriptResearchJobId
                        : !scriptNoResearchAcknowledged)
                    }
                    style={{
                      border: "none",
                      backgroundColor:
                        scriptModalSubmitting ||
                        scriptRunsLoading ||
                        (scriptResearchRuns.length > 0
                          ? !selectedScriptResearchJobId
                          : !scriptNoResearchAcknowledged)
                          ? "#1e293b"
                          : "#0ea5e9",
                      color:
                        scriptModalSubmitting ||
                        scriptRunsLoading ||
                        (scriptResearchRuns.length > 0
                          ? !selectedScriptResearchJobId
                          : !scriptNoResearchAcknowledged)
                          ? "#64748b"
                          : "#ffffff",
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor:
                        scriptModalSubmitting ||
                        scriptRunsLoading ||
                        (scriptResearchRuns.length > 0
                          ? !selectedScriptResearchJobId
                          : !scriptNoResearchAcknowledged)
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {scriptModalSubmitting ? "Starting AI generation..." : "Generate with AI"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ margin: "0 0 12px 0", color: "#cbd5e1", fontSize: 14 }}>
                  Paste your script below. This bypasses AI generation and saves your text directly.
                </p>
                <textarea
                  value={scriptUploadText}
                  onChange={(e) => setScriptUploadText(e.target.value)}
                  disabled={scriptModalSubmitting}
                  placeholder="Paste your script text here..."
                  rows={10}
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    color: "#e2e8f0",
                    padding: 12,
                    fontSize: 14,
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (scriptModalSubmitting) return;
                      setScriptModalMode("choose");
                      setScriptModalError(null);
                    }}
                    style={{
                      border: "1px solid #334155",
                      backgroundColor: "#0b1220",
                      color: "#cbd5e1",
                      padding: "8px 12px",
                      borderRadius: 8,
                      cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadScript}
                    disabled={scriptModalSubmitting}
                    style={{
                      border: "none",
                      backgroundColor: scriptModalSubmitting ? "#1e293b" : "#0ea5e9",
                      color: scriptModalSubmitting ? "#64748b" : "#ffffff",
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: scriptModalSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {scriptModalSubmitting ? "Uploading..." : "Upload Script"}
                  </button>
                </div>
              </div>
            )}

            {scriptModalError && (
              <p style={{ margin: "12px 0 0 0", color: "#fca5a5", fontSize: 13 }}>{scriptModalError}</p>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <Link
          href={`/projects/${projectId}/research-hub`}
          style={{
            border: "1px solid #334155",
            backgroundColor: "#0b1220",
            color: "#cbd5e1",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Back to Research Hub
        </Link>
      </div>

      <Toaster position="top-right" />
    </div>
  );
}
