// app/projects/[projectId]/creative-studio/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStatus, JobType } from "@prisma/client";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";
import RunManagementModal from "@/components/RunManagementModal";

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
  creatorReferenceImageUrl?: string | null;
  productReferenceImageUrl?: string | null;
  soraCharacterId?: string | null;
};

type ResearchRunOption = {
  jobId: string;
  runId?: string | null;
  createdAt: string;
  updatedAt?: string;
  summary?: string | null;
};

type ProjectRunMetadata = {
  id: string;
  name: string | null;
  runNumber: number;
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
  aiDataQuality?: "partial" | "minimal" | null;
};

type GeneratedBeatDataQuality = "full" | "partial" | "minimal";

type GenerateBeatResponse = {
  vo: string;
  dataQuality: GeneratedBeatDataQuality;
  beatLabel: string;
  insertionIndex: number;
};

type ScriptDetails = {
  id: string;
  status: string;
  rawJson: unknown;
  wordCount: number | null;
  createdAt: string;
};

const DEFAULT_SCRIPT_TARGET_DURATION_SECONDS = 30;

type ScriptRunSummarySource = {
  present: boolean;
  jobId: string | null;
  completedAt: string | null;
  avatarSummary?: string | null;
  productName?: string | null;
};

type ScriptRunSummary = {
  runId: string;
  customerAnalysis: ScriptRunSummarySource;
  patternAnalysis: ScriptRunSummarySource;
  productCollection: ScriptRunSummarySource;
};

type AddBeatExpansionProps = {
  afterIndex: number;
  disabled: boolean;
  onWriteYourself: (afterIndex: number, beatLabel: string) => void;
  onGenerateWithAi: (afterIndex: number, beatLabel: string) => Promise<void>;
};

function defaultInsertBeatLabel(afterIndex: number): string {
  return `Beat ${afterIndex + 2}`;
}

function AddBeatExpansion({
  afterIndex,
  disabled,
  onWriteYourself,
  onGenerateWithAi,
}: AddBeatExpansionProps) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState(() => defaultInsertBeatLabel(afterIndex));
  const [selectedOption, setSelectedOption] = useState<"write" | "ai" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded && !loading) {
      setLabel(defaultInsertBeatLabel(afterIndex));
    }
  }, [afterIndex, expanded, loading]);

  useEffect(() => {
    console.log("[CreativeStudio] add-beat expansion state", {
      afterIndex,
      expanded,
      selectedOption,
    });
  }, [afterIndex, expanded, selectedOption]);

  function normalizedLabel(): string {
    const trimmed = label.trim();
    return trimmed || defaultInsertBeatLabel(afterIndex);
  }

  function handleToggleExpanded() {
    setExpanded((previous) => {
      const next = !previous;
      console.log("[CreativeStudio] toggle add-beat expansion", {
        afterIndex,
        expanded: next,
      });
      if (!next) {
        setError(null);
        setSelectedOption(null);
        setLoading(false);
        setLabel(defaultInsertBeatLabel(afterIndex));
      }
      return next;
    });
  }

  function handleWriteYourself() {
    if (disabled || loading) return;
    setSelectedOption("write");
    setError(null);
    onWriteYourself(afterIndex, normalizedLabel());
    setExpanded(false);
    setSelectedOption(null);
    setLabel(defaultInsertBeatLabel(afterIndex));
  }

  async function runGenerateWithAi() {
    if (disabled || loading) return;
    setSelectedOption("ai");
    setError(null);
    setLoading(true);
    try {
      await onGenerateWithAi(afterIndex, normalizedLabel());
      setExpanded(false);
      setSelectedOption(null);
      setLabel(defaultInsertBeatLabel(afterIndex));
    } catch (err: any) {
      setError(err?.message || "Failed to generate beat");
    } finally {
      setLoading(false);
    }
  }

  if (!expanded) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleToggleExpanded}
          disabled={disabled}
          style={{
            border: "1px solid #334155",
            backgroundColor: "#0f172a",
            color: disabled ? "#64748b" : "#cbd5e1",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 12,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          + Add Beat Below
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #334155",
        backgroundColor: "#020617",
        borderRadius: 8,
        padding: 10,
        display: "grid",
        gap: 8,
      }}
    >
      <input
        type="text"
        value={label}
        onChange={(event) => {
          setLabel(event.target.value);
          setError(null);
        }}
        placeholder="Beat label"
        disabled={disabled || loading}
        style={{
          width: "100%",
          boxSizing: "border-box",
          borderRadius: 8,
          border: "1px solid #334155",
          backgroundColor: "#0f172a",
          color: "#e2e8f0",
          padding: "7px 9px",
          fontSize: 13,
        }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          onClick={handleWriteYourself}
          disabled={disabled || loading}
          style={{
            border: "1px solid #334155",
            backgroundColor: selectedOption === "write" ? "#1e293b" : "#0f172a",
            color: disabled || loading ? "#64748b" : "#cbd5e1",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled || loading ? "not-allowed" : "pointer",
          }}
        >
          Write Yourself
        </button>
        <button
          type="button"
          onClick={() => void runGenerateWithAi()}
          disabled={disabled || loading}
          style={{
            border: "none",
            backgroundColor: disabled || loading ? "#1e293b" : "#0ea5e9",
            color: disabled || loading ? "#94a3b8" : "#ffffff",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: disabled || loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }}
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  style={{ opacity: 0.75 }}
                />
              </svg>
              Generating...
            </>
          ) : (
            "Generate with AI"
          )}
        </button>
        <button
          type="button"
          onClick={handleToggleExpanded}
          disabled={disabled || loading}
          style={{
            border: "1px solid #334155",
            backgroundColor: "transparent",
            color: disabled || loading ? "#64748b" : "#94a3b8",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled || loading ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div
          style={{
            borderRadius: 6,
            border: "1px solid rgba(239, 68, 68, 0.4)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "#fca5a5",
            fontSize: 12,
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void runGenerateWithAi()}
            disabled={disabled || loading}
            style={{
              border: "1px solid rgba(239, 68, 68, 0.45)",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              color: disabled || loading ? "#64748b" : "#fecaca",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              fontWeight: 600,
              cursor: disabled || loading ? "not-allowed" : "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [scriptTargetDuration, setScriptTargetDuration] = useState<number>(30);
  const [scriptBeatCount, setScriptBeatCount] = useState<number>(5);
  const [scriptNoResearchAcknowledged, setScriptNoResearchAcknowledged] = useState(false);
  const [scriptModalSubmitting, setScriptModalSubmitting] = useState(false);
  const [scriptModalError, setScriptModalError] = useState<string | null>(null);
  const [scriptRunSummary, setScriptRunSummary] = useState<ScriptRunSummary | null>(null);
  const [scriptRunSummaryLoading, setScriptRunSummaryLoading] = useState(false);
  const [scriptRunSummaryError, setScriptRunSummaryError] = useState<string | null>(null);
  const [scriptPanelOpenId, setScriptPanelOpenId] = useState<string | null>(null);
  const [scriptPanelLoading, setScriptPanelLoading] = useState(false);
  const [scriptPanelError, setScriptPanelError] = useState<string | null>(null);
  const [scriptPanelData, setScriptPanelData] = useState<ScriptDetails | null>(null);
  const [scriptPanelEditMode, setScriptPanelEditMode] = useState(false);
  const [scriptPanelDraftBeats, setScriptPanelDraftBeats] = useState<ScriptBeat[]>([]);
  const [scriptPanelSaving, setScriptPanelSaving] = useState(false);
  const [storyboardPanelData, setStoryboardPanelData] = useState<StoryboardDetails | null>(null);
  const [storyboardPanelLoading, setStoryboardPanelLoading] = useState(false);
  const [storyboardPanelError, setStoryboardPanelError] = useState<string | null>(null);
  const [storyboardPanelId, setStoryboardPanelId] = useState<string | null>(null);
  const [storyboardEditMode, setStoryboardEditMode] = useState(false);
  const [storyboardDraftPanels, setStoryboardDraftPanels] = useState<StoryboardPanel[]>([]);
  const [storyboardSaveError, setStoryboardSaveError] = useState<string | null>(null);
  const [storyboardSaving, setStoryboardSaving] = useState(false);
  const [storyboardRegeneratingIndex, setStoryboardRegeneratingIndex] = useState<number | null>(null);
  const [storyboardRegenerateError, setStoryboardRegenerateError] = useState<string | null>(null);
  const [videoPromptEditMode, setVideoPromptEditMode] = useState(false);
  const [videoPromptDrafts, setVideoPromptDrafts] = useState<string[]>([]);
  const [videoPromptSaveError, setVideoPromptSaveError] = useState<string | null>(null);
  const [videoPromptSaving, setVideoPromptSaving] = useState(false);
  const [videoPromptRegeneratingIndex, setVideoPromptRegeneratingIndex] = useState<number | null>(null);
  const [videoPromptRegenerateError, setVideoPromptRegenerateError] = useState<string | null>(null);
  const [imagePromptEditMode, setImagePromptEditMode] = useState(false);
  const [imagePromptDrafts, setImagePromptDrafts] = useState<
    Array<{ firstFramePrompt: string; lastFramePrompt: string }>
  >([]);
  const [imagePromptSaveError, setImagePromptSaveError] = useState<string | null>(null);
  const [imagePromptSaving, setImagePromptSaving] = useState(false);
  const [sceneReviewOpenByNumber, setSceneReviewOpenByNumber] = useState<Record<number, boolean>>({});
  const [sceneGeneratingNumber, setSceneGeneratingNumber] = useState<number | null>(null);
  const [sceneApprovingNumber, setSceneApprovingNumber] = useState<number | null>(null);
  const [sceneActionError, setSceneActionError] = useState<string | null>(null);
  const [resettingVideoImageJobId, setResettingVideoImageJobId] = useState<string | null>(null);
  const [cleaningOrphanedJobs, setCleaningOrphanedJobs] = useState(false);
  const [expandedCompletedStepKeys, setExpandedCompletedStepKeys] = useState<Record<string, boolean>>({});
  const [showRunManagerModal, setShowRunManagerModal] = useState(false);
  const [projectRunsById, setProjectRunsById] = useState<Record<string, ProjectRunMetadata>>({});
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

  const loadProjectRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) return;
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
      // best-effort metadata enrichment; ignore failures
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
    void loadProjectRuns();
  }, [loadProjectRuns, projectId]);

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
  const selectedScriptResearchRun = useMemo(
    () => scriptResearchRuns.find((run) => run.jobId === selectedScriptResearchJobId) ?? null,
    [scriptResearchRuns, selectedScriptResearchJobId],
  );

  function getRunJobName(job: Job) {
    const names: Record<string, string> = {
      SCRIPT_GENERATION: "Generate Script",
      STORYBOARD_GENERATION: "Create Storyboard",
      IMAGE_PROMPT_GENERATION: "Generate Image Prompts",
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
        }),
    [projectRunsById, runGroupsList, runNumberByRunId]
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
  const selectedRunJobs = useMemo(() => selectedRun?.jobs ?? [], [selectedRun]);
  const hasSelectedRunWithJobs = Boolean(selectedRunId && selectedRunJobs.length > 0);
  const orphanedJobsCount = useMemo(
    () => jobs.filter((job) => !String(job.runId ?? "").trim()).length,
    [jobs],
  );
  const jobsInActiveRun = useMemo(
    () => (hasSelectedRunWithJobs ? selectedRunJobs : []),
    [hasSelectedRunWithJobs, selectedRunJobs],
  );
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  const hasSelectedProductCreatorReference = Boolean(
    String(selectedProduct?.creatorReferenceImageUrl ?? "").trim(),
  );
  const hasSelectedProductSoraCharacter = Boolean(
    String(selectedProduct?.soraCharacterId ?? "").trim(),
  );
  const latestCompletedStoryboardJob = useMemo(
    () => {
      const sortByNewest = (a: Job, b: Job) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
      const inSelectedRun = jobsInActiveRun
        .filter(
          (job) => job.type === JobType.STORYBOARD_GENERATION && job.status === JobStatus.COMPLETED,
        )
        .sort(sortByNewest);
      if (inSelectedRun[0]) return inSelectedRun[0];
      return (
        jobs
          .filter(
            (job) => job.type === JobType.STORYBOARD_GENERATION && job.status === JobStatus.COMPLETED,
          )
          .sort(sortByNewest)[0] ?? null
      );
    },
    [jobs, jobsInActiveRun],
  );
  const latestCompletedStoryboardId = useMemo(
    () => getStoryboardIdFromJob(latestCompletedStoryboardJob),
    [latestCompletedStoryboardJob],
  );

  useEffect(() => {
    console.log("[Creative] selectedRunId state", {
      selectedRunId: selectedRunId ?? null,
      selectedRunFound: Boolean(selectedRun),
      selectedRunJobCount: selectedRunJobs.length,
    });
  }, [selectedRun, selectedRunId, selectedRunJobs.length]);

  useEffect(() => {
    closeScriptPanel();
    setExpandedCompletedStepKeys({});
    setVideoPromptEditMode(false);
    setVideoPromptDrafts([]);
    setVideoPromptSaveError(null);
    setVideoPromptSaving(false);
    setVideoPromptRegeneratingIndex(null);
    setVideoPromptRegenerateError(null);
    setImagePromptEditMode(false);
    setImagePromptDrafts([]);
    setImagePromptSaveError(null);
    setImagePromptSaving(false);
    setSceneReviewOpenByNumber({});
    setSceneGeneratingNumber(null);
    setSceneApprovingNumber(null);
    setSceneActionError(null);
  }, [selectedRunId]);

  useEffect(() => {
    if (!latestCompletedStoryboardId) {
      setStoryboardPanelId(null);
      setStoryboardPanelData(null);
      setStoryboardPanelLoading(false);
      setStoryboardPanelError(null);
      setStoryboardEditMode(false);
      setStoryboardDraftPanels([]);
      setStoryboardSaveError(null);
      setStoryboardSaving(false);
      setStoryboardRegeneratingIndex(null);
      setStoryboardRegenerateError(null);
      setVideoPromptEditMode(false);
      setVideoPromptDrafts([]);
      setVideoPromptSaveError(null);
      setVideoPromptSaving(false);
      setVideoPromptRegeneratingIndex(null);
      setVideoPromptRegenerateError(null);
      setImagePromptEditMode(false);
      setImagePromptDrafts([]);
      setImagePromptSaveError(null);
      setImagePromptSaving(false);
      setSceneReviewOpenByNumber({});
      setSceneGeneratingNumber(null);
      setSceneApprovingNumber(null);
      setSceneActionError(null);
      return;
    }

    let cancelled = false;
    setStoryboardPanelId(latestCompletedStoryboardId);
    setStoryboardPanelLoading(true);
    setStoryboardPanelError(null);
    setVideoPromptEditMode(false);
    setVideoPromptDrafts([]);
    setVideoPromptSaveError(null);
    setVideoPromptSaving(false);
    setVideoPromptRegeneratingIndex(null);
    setVideoPromptRegenerateError(null);
    setImagePromptEditMode(false);
    setImagePromptDrafts([]);
    setImagePromptSaveError(null);
    setImagePromptSaving(false);
    setSceneReviewOpenByNumber({});
    setSceneGeneratingNumber(null);
    setSceneApprovingNumber(null);
    setSceneActionError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/storyboards/${latestCompletedStoryboardId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        const storyboardPayload =
          data?.storyboard && typeof data.storyboard === "object"
            ? (data.storyboard as Record<string, unknown>)
            : null;
        const panelsPayload = Array.isArray(storyboardPayload?.panels)
          ? storyboardPayload.panels
          : null;
        const firstPanel =
          panelsPayload && panelsPayload[0] && typeof panelsPayload[0] === "object"
            ? (panelsPayload[0] as Record<string, unknown>)
            : null;
        console.log("[Creative][Storyboard] fetch response", {
          storyboardId: latestCompletedStoryboardId,
          httpStatus: res.status,
          ok: res.ok,
          data,
        });
        console.log("[Creative][Storyboard] payload shape", {
          hasStoryboardObject: Boolean(storyboardPayload),
          storyboardKeys: storyboardPayload ? Object.keys(storyboardPayload) : [],
          panelsIsArray: Array.isArray(storyboardPayload?.panels),
          panelsCount: panelsPayload?.length ?? 0,
          firstPanelKeys: firstPanel ? Object.keys(firstPanel) : [],
        });
        if (!res.ok || !data?.storyboard) {
          throw new Error(data?.error || "Failed to load storyboard panels");
        }
        if (cancelled) return;
        const storyboard = data.storyboard as StoryboardDetails;
        const normalizedPanels = Array.isArray(storyboard.panels)
          ? storyboard.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
          : [];
        const validationReport = normalizeValidationReport(
          (data?.storyboard as Record<string, unknown> | undefined)?.validationReport,
        );
        setStoryboardPanelData({
          ...storyboard,
          panels: normalizedPanels,
          validationReport,
        });
        setStoryboardDraftPanels(normalizedPanels);
        setStoryboardEditMode(false);
        setStoryboardSaveError(null);
        setStoryboardRegeneratingIndex(null);
        setStoryboardRegenerateError(null);
        if (!Array.isArray(storyboard.panels) || storyboard.panels.length === 0) {
          setStoryboardPanelError("Storyboard generation failed to produce output.");
        } else {
          setStoryboardPanelError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setStoryboardPanelData(null);
        setStoryboardDraftPanels([]);
        setStoryboardEditMode(false);
        setStoryboardPanelError(err?.message || "Failed to load storyboard panels");
      } finally {
        if (cancelled) return;
        setStoryboardPanelLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [latestCompletedStoryboardId]);

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

  function normalizeValidationReport(value: unknown): ValidationReport | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const warnings = Array.isArray(raw.warnings)
      ? raw.warnings
          .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
          .filter(Boolean)
      : [];
    const qualityScoreRaw = Number(raw.qualityScore);
    const qualityScore = Number.isFinite(qualityScoreRaw)
      ? Math.max(0, Math.min(100, Math.round(qualityScoreRaw)))
      : 0;
    const gatesPassed = Boolean(raw.gatesPassed);

    return {
      gatesPassed,
      warnings,
      qualityScore,
    };
  }

  function getValidationReportFromResultSummary(resultSummary: unknown): ValidationReport | null {
    if (!resultSummary || typeof resultSummary !== "object") return null;
    const raw = resultSummary as Record<string, unknown>;
    return normalizeValidationReport(raw.validationReport);
  }

  function getScriptValidationReportFromRawJson(rawJson: unknown): ValidationReport | null {
    if (!rawJson || typeof rawJson !== "object") return null;
    const root = rawJson as Record<string, unknown>;
    return normalizeValidationReport(root.validationReport);
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

  function formatStoryboardPanelTiming(panel: StoryboardPanel): string {
    const start = String(panel.startTime || "").trim();
    const end = String(panel.endTime || "").trim();
    if (start && end) return `${start}-${end}`;
    if (start) return start;
    if (end) return end;
    return "No timing";
  }

  function getSceneLastFrameImageUrl(panel: StoryboardPanel | null | undefined): string {
    if (!panel) return "";
    return String(panel.lastFrameImageUrl || panel.firstFrameImageUrl || "").trim();
  }

  function normalizeStoryboardPanel(panel: unknown, index: number): StoryboardPanel {
    const raw = panel && typeof panel === "object" ? (panel as Record<string, unknown>) : {};
    const asValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const panelTypeRaw = asValue(raw.panelType);
    const panelType = panelTypeRaw === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA";
    const characterAction = asValue(raw.characterAction);
    const environment = asValue(raw.environment);
    const sceneNumberRaw = Number(raw.sceneNumber);
    const sceneNumber = Number.isFinite(sceneNumberRaw) && sceneNumberRaw > 0
      ? Math.trunc(sceneNumberRaw)
      : index + 1;
    return {
      sceneId: asValue(raw.sceneId) || undefined,
      sceneNumber,
      approved: Boolean(raw.approved),
      panelType,
      beatLabel: asValue(raw.beatLabel) || `Beat ${index + 1}`,
      startTime: asValue(raw.startTime),
      endTime: asValue(raw.endTime),
      vo: asValue(raw.vo),
      firstFramePrompt: asValue(raw.firstFramePrompt) || null,
      lastFramePrompt: asValue(raw.lastFramePrompt) || null,
      firstFrameImageUrl: asValue(raw.firstFrameImageUrl) || null,
      lastFrameImageUrl: asValue(raw.lastFrameImageUrl) || null,
      videoPrompt: asValue(raw.videoPrompt) || null,
      characterAction: characterAction || null,
      environment: environment || null,
      cameraDirection: asValue(raw.cameraDirection),
      productPlacement: asValue(raw.productPlacement),
      bRollSuggestions: Array.isArray(raw.bRollSuggestions)
        ? raw.bRollSuggestions
            .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
            .filter(Boolean)
        : [],
      transitionType: asValue(raw.transitionType),
    };
  }

  function createEmptyStoryboardPanel(index: number, previousPanel?: StoryboardPanel): StoryboardPanel {
    const anchorTime = String(previousPanel?.endTime || previousPanel?.startTime || "0s").trim() || "0s";
    return {
      sceneId: undefined,
      sceneNumber: index + 1,
      approved: false,
      panelType: "ON_CAMERA",
      beatLabel: `Beat ${index + 1}`,
      startTime: anchorTime,
      endTime: anchorTime,
      vo: "",
      firstFramePrompt: null,
      lastFramePrompt: null,
      firstFrameImageUrl: null,
      lastFrameImageUrl: null,
      videoPrompt: null,
      characterAction: null,
      environment: null,
      cameraDirection: "",
      productPlacement: "",
      bRollSuggestions: [],
      transitionType: "",
    };
  }

  function bRollSuggestionsToTextarea(value: string[]): string {
    return value.join("\n");
  }

  function parseBrollSuggestionsTextarea(value: string): string[] {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function getSourceRowContent(source: ScriptRunSummarySource, fallback: string): {
    text: string;
    missing: boolean;
  } {
    if (!source.present) {
      return { text: "Missing for this run", missing: true };
    }

    const customText = fallback.trim();
    if (customText) {
      return { text: customText, missing: false };
    }

    if (source.completedAt) {
      return { text: formatMetadataDate(source.completedAt), missing: false };
    }

    return { text: "Completed job found, but date unavailable", missing: true };
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

  function getStoryboardIdFromJob(job: Job | null | undefined): string | null {
    if (!job) return null;

    const payload = job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : null;
    const payloadResult =
      payload?.result && typeof payload.result === "object"
        ? (payload.result as Record<string, unknown>)
        : null;

    const fromPayloadResult =
      typeof payloadResult?.storyboardId === "string" && payloadResult.storyboardId.trim()
        ? payloadResult.storyboardId.trim()
        : null;
    if (fromPayloadResult) return fromPayloadResult;

    const fromPayload =
      typeof payload?.storyboardId === "string" && payload.storyboardId.trim()
        ? payload.storyboardId.trim()
        : null;
    if (fromPayload) return fromPayload;

    if (job.resultSummary && typeof job.resultSummary === "object") {
      const summaryObj = job.resultSummary as Record<string, unknown>;
      const fromSummaryObj =
        typeof summaryObj.storyboardId === "string" && summaryObj.storyboardId.trim()
          ? summaryObj.storyboardId.trim()
          : null;
      if (fromSummaryObj) return fromSummaryObj;
      const nestedSummary =
        summaryObj.summary && typeof summaryObj.summary === "object"
          ? (summaryObj.summary as Record<string, unknown>)
          : null;
      const fromNestedSummary =
        typeof nestedSummary?.storyboardId === "string" && nestedSummary.storyboardId.trim()
          ? nestedSummary.storyboardId.trim()
          : null;
      if (fromNestedSummary) return fromNestedSummary;
    }

    if (typeof job.resultSummary === "string" && job.resultSummary.trim()) {
      const match = job.resultSummary.match(/storyboardId=([^) ,]+)/);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  function cleanScriptBeatLabel(rawBeat: string | null | undefined): string {
    const normalized = String(rawBeat ?? "").trim();
    if (!normalized) return "Hook";

    const hasColonAndArrow =
      normalized.includes(":") && (normalized.includes("->") || normalized.includes("→"));

    if (hasColonAndArrow || normalized.length > 40) {
      return "Hook";
    }

    return normalized;
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
      const aiDataQualityValue = parsed.aiDataQuality;
      const aiDataQuality =
        aiDataQualityValue === "partial" || aiDataQualityValue === "minimal"
          ? aiDataQualityValue
          : null;
      return {
        beat: cleanScriptBeatLabel(
          typeof beatValue === "string" && beatValue.trim() ? beatValue.trim() : `Beat ${index + 1}`
        ),
        duration:
          typeof durationValue === "number" || typeof durationValue === "string"
            ? durationValue
            : null,
        vo: typeof voValue === "string" ? voValue : "",
        aiDataQuality,
      };
    });
  }

  function normalizeScriptTargetDuration(rawJson: unknown): number {
    if (!rawJson || typeof rawJson !== "object") return DEFAULT_SCRIPT_TARGET_DURATION_SECONDS;
    const value = (rawJson as Record<string, unknown>).targetDuration;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_SCRIPT_TARGET_DURATION_SECONDS;
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 180) return DEFAULT_SCRIPT_TARGET_DURATION_SECONDS;
    return rounded;
  }

  function normalizeScriptBeatCount(rawJson: unknown, fallback: number): number {
    if (!rawJson || typeof rawJson !== "object") return fallback;
    const value = (rawJson as Record<string, unknown>).beatCount;
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 20) return fallback;
    return rounded;
  }

  function formatSecondsForBeatDuration(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(1).replace(/\.0$/, "");
  }

  function buildEvenBeatDurations(targetDuration: number, beatCount: number): string[] {
    if (beatCount <= 0) return [];
    const secondsPerBeat = targetDuration / beatCount;
    let start = 0;
    const durations: string[] = [];

    for (let i = 0; i < beatCount; i++) {
      const end = i === beatCount - 1 ? targetDuration : start + secondsPerBeat;
      durations.push(`${formatSecondsForBeatDuration(start)}-${formatSecondsForBeatDuration(end)}s`);
      start = end;
    }
    return durations;
  }

  function redistributeBeatDurations(beats: ScriptBeat[], targetDuration: number): ScriptBeat[] {
    if (beats.length === 0) return [];
    const durations = buildEvenBeatDurations(targetDuration, beats.length);
    return beats.map((beat, index) => ({
      ...beat,
      beat: String(beat.beat || `Beat ${index + 1}`).trim() || `Beat ${index + 1}`,
      duration: durations[index] ?? beat.duration ?? null,
    }));
  }

  function formatSceneDuration(value: string | number | null): string {
    if (value == null) return "No timing";
    if (typeof value === "number") return `${value}s`;
    const normalized = value.trim();
    if (!normalized) return "No timing";
    return normalized.endsWith("s") ? normalized : `${normalized}s`;
  }

  function applyBeatStructureChange(updater: (prev: ScriptBeat[]) => ScriptBeat[]) {
    setScriptPanelDraftBeats((prev) => {
      const next = updater(prev);
      const targetDuration = normalizeScriptTargetDuration(scriptPanelData?.rawJson);
      return redistributeBeatDurations(next, targetDuration);
    });
  }

  function normalizeInsertBeatLabel(rawValue: string, afterIndex: number): string {
    const normalized = rawValue.trim();
    if (normalized) return normalized;
    return defaultInsertBeatLabel(afterIndex);
  }

  function insertBeatAtIndex(
    insertionIndex: number,
    beatLabel: string,
    vo: string,
    dataQuality?: GeneratedBeatDataQuality | null,
  ) {
    applyBeatStructureChange((prev) => {
      const next = [...prev];
      next.splice(insertionIndex, 0, {
        beat: beatLabel,
        duration: null,
        vo,
        aiDataQuality:
          dataQuality === "partial" || dataQuality === "minimal" ? dataQuality : null,
      });
      return next;
    });
  }

  function handleInsertBeatWriteYourself(afterIndex: number, rawBeatLabel: string) {
    if (scriptPanelSaving) return;
    const insertionIndex = afterIndex + 1;
    const beatLabel = normalizeInsertBeatLabel(rawBeatLabel, afterIndex);
    insertBeatAtIndex(insertionIndex, beatLabel, "");
  }

  async function handleInsertBeatGenerateWithAi(afterIndex: number, rawBeatLabel: string) {
    if (!scriptPanelOpenId || !scriptPanelData || scriptPanelSaving) {
      throw new Error("Script editor is not ready yet. Try again.");
    }

    const insertionIndex = afterIndex + 1;
    const beatLabel = normalizeInsertBeatLabel(rawBeatLabel, afterIndex);
    const targetDuration = normalizeScriptTargetDuration(scriptPanelData.rawJson);
    const beatCount = normalizeScriptBeatCount(scriptPanelData.rawJson, scriptPanelDraftBeats.length + 1);
    const existingScenes = scriptPanelDraftBeats.map((scene, index) => ({
      beat: String(scene.beat || `Beat ${index + 1}`).trim() || `Beat ${index + 1}`,
      vo: typeof scene.vo === "string" ? scene.vo : "",
    }));

    try {
      const response = await fetch(`/api/scripts/${scriptPanelOpenId}/generate-beat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beatLabel,
          insertionIndex,
          existingScenes,
          targetDuration,
          beatCount,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<GenerateBeatResponse> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate beat");
      }

      const generatedVo = typeof data.vo === "string" ? data.vo.trim() : "";
      if (!generatedVo) {
        throw new Error("AI returned an empty beat. Try again.");
      }

      insertBeatAtIndex(insertionIndex, beatLabel, generatedVo, data.dataQuality ?? null);
    } catch (err: any) {
      throw new Error(err?.message || "Failed to generate beat");
    }
  }

  function handleDeleteBeat(index: number) {
    applyBeatStructureChange((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  }

  function handleMoveBeat(index: number, direction: "up" | "down") {
    applyBeatStructureChange((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function getScriptTargetDurationSeconds(rawJson: unknown, fallbackBeatCount: number): number {
    const root = rawJson && typeof rawJson === "object" ? (rawJson as Record<string, unknown>) : {};
    const candidateValues = [
      root.targetDuration,
      root.target_duration,
      root.durationSeconds,
      root.duration_seconds,
    ];
    for (const value of candidateValues) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
      }
    }

    const fallbackCount = Math.max(1, fallbackBeatCount || 0);
    return fallbackCount * 6;
  }

  function redistributeScriptBeatTiming(beats: ScriptBeat[], targetDuration: number): ScriptBeat[] {
    if (!beats.length) return beats;
    const perBeat = Number((targetDuration / beats.length).toFixed(2));
    return beats.map((beat, index) => ({
      ...beat,
      beat: cleanScriptBeatLabel(beat.beat) || `Beat ${index + 1}`,
      duration: perBeat,
    }));
  }

  function updateScriptBeatLabel(sceneIndex: number, value: string) {
    setScriptPanelDraftBeats((prev) =>
      prev.map((beat, idx) =>
        idx === sceneIndex
          ? {
              ...beat,
              beat: value,
            }
          : beat,
      ),
    );
  }

  function updateScriptBeatVo(sceneIndex: number, value: string) {
    setScriptPanelDraftBeats((prev) =>
      prev.map((beat, idx) =>
        idx === sceneIndex
          ? {
              ...beat,
              vo: value,
            }
          : beat,
      ),
    );
  }

  function handleMoveScriptBeat(sceneIndex: number, direction: -1 | 1) {
    const targetDuration = getScriptTargetDurationSeconds(
      scriptPanelData?.rawJson,
      scriptPanelDraftBeats.length,
    );
    setScriptPanelDraftBeats((prev) => {
      const destinationIndex = sceneIndex + direction;
      if (destinationIndex < 0 || destinationIndex >= prev.length) return prev;
      const reordered = [...prev];
      const [moved] = reordered.splice(sceneIndex, 1);
      reordered.splice(destinationIndex, 0, moved);
      return redistributeScriptBeatTiming(reordered, targetDuration);
    });
  }

  function handleDeleteScriptBeat(sceneIndex: number) {
    const targetDuration = getScriptTargetDurationSeconds(
      scriptPanelData?.rawJson,
      scriptPanelDraftBeats.length,
    );
    setScriptPanelDraftBeats((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((_, idx) => idx !== sceneIndex);
      return redistributeScriptBeatTiming(filtered, targetDuration);
    });
  }

  function handleInsertBlankScriptBeat(beatLabel: string, insertionIndex: number) {
    const targetDuration = getScriptTargetDurationSeconds(
      scriptPanelData?.rawJson,
      scriptPanelDraftBeats.length + 1,
    );
    setScriptPanelDraftBeats((prev) => {
      const next = [...prev];
      next.splice(insertionIndex, 0, {
        beat: cleanScriptBeatLabel(beatLabel),
        vo: "",
        duration: null,
        aiDataQuality: null,
      });
      return redistributeScriptBeatTiming(next, targetDuration);
    });
  }

  async function handleInsertAiScriptBeat(beatLabel: string, insertionIndex: number): Promise<void> {
    const activeScriptId = String(scriptPanelOpenId ?? "").trim();
    if (!activeScriptId) {
      throw new Error("Script panel is not active.");
    }

    const currentBeats = [...scriptPanelDraftBeats];
    const targetDuration = getScriptTargetDurationSeconds(scriptPanelData?.rawJson, currentBeats.length + 1);
    const nextBeatCount = Math.max(1, currentBeats.length + 1);
    const normalizedLabel = cleanScriptBeatLabel(beatLabel) || `Beat ${insertionIndex + 1}`;

    const res = await fetch(`/api/scripts/${activeScriptId}/generate-beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beatLabel: normalizedLabel,
        insertionIndex,
        existingScenes: currentBeats.map((scene) => ({
          beat: scene.beat,
          vo: scene.vo,
          duration: scene.duration,
        })),
        targetDuration,
        beatCount: nextBeatCount,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Failed to generate beat");
    }

    const vo = typeof data?.vo === "string" ? data.vo.trim() : "";
    if (!vo) {
      throw new Error("AI returned empty beat text.");
    }

    const dataQuality: "full" | "partial" | "minimal" =
      data?.dataQuality === "full" || data?.dataQuality === "partial" || data?.dataQuality === "minimal"
        ? data.dataQuality
        : "minimal";

    setScriptPanelDraftBeats((prev) => {
      const next = [...prev];
      next.splice(insertionIndex, 0, {
        beat: normalizedLabel,
        vo,
        duration: null,
        aiDataQuality: dataQuality,
      });
      return redistributeScriptBeatTiming(next, targetDuration);
    });

    if (dataQuality === "partial") {
      toast("Limited research data used for this beat.", { icon: "⚠️" });
    }
    if (dataQuality === "minimal") {
      toast("No research data found for this beat. Review carefully.", { icon: "⚠️" });
    }
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
      const targetDuration = normalizeScriptTargetDuration(scriptPanelData?.rawJson);
      const recalculatedScenes = redistributeBeatDurations(scriptPanelDraftBeats, targetDuration);
      const payloadScenes = recalculatedScenes.map((scene) => ({
        beat: scene.beat,
        duration: scene.duration,
        vo: scene.vo,
      }));
      const res = await fetch(`/api/projects/${projectId}/scripts/${scriptPanelOpenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: payloadScenes,
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

  function openStoryboardEditMode() {
    setStoryboardDraftPanels(
      Array.isArray(storyboardPanelData?.panels)
        ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
        : [],
    );
    setStoryboardEditMode(true);
    setStoryboardSaveError(null);
    setStoryboardRegenerateError(null);
  }

  function cancelStoryboardEditMode() {
    setStoryboardDraftPanels(
      Array.isArray(storyboardPanelData?.panels)
        ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
        : [],
    );
    setStoryboardEditMode(false);
    setStoryboardSaveError(null);
    setStoryboardRegenerateError(null);
    setStoryboardRegeneratingIndex(null);
  }

  function updateStoryboardDraftPanel(
    panelIndex: number,
    updater: (panel: StoryboardPanel) => StoryboardPanel,
  ) {
    setStoryboardDraftPanels((prev) =>
      prev.map((panel, index) => (index === panelIndex ? updater(panel) : panel)),
    );
  }

  function handleAddStoryboardPanel(afterIndex: number) {
    setStoryboardDraftPanels((prev) => {
      const insertionIndex = afterIndex + 1;
      const previousPanel = prev[afterIndex];
      const next = [...prev];
      next.splice(insertionIndex, 0, createEmptyStoryboardPanel(insertionIndex, previousPanel));
      return next.map((panel, index) => ({
        ...panel,
        beatLabel: panel.beatLabel.trim() || `Beat ${index + 1}`,
      }));
    });
  }

  function handleDeleteStoryboardPanel(panelIndex: number) {
    setStoryboardDraftPanels((prev) => {
      if (prev.length <= 1) return prev;
      return prev
        .filter((_, index) => index !== panelIndex)
        .map((panel, index) => ({
          ...panel,
          beatLabel: panel.beatLabel.trim() || `Beat ${index + 1}`,
        }));
    });
  }

  function handleMoveStoryboardPanel(panelIndex: number, direction: -1 | 1) {
    setStoryboardDraftPanels((prev) => {
      const destination = panelIndex + direction;
      if (destination < 0 || destination >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(panelIndex, 1);
      next.splice(destination, 0, moved);
      return next;
    });
  }

  async function handleRegenerateStoryboardPanel(panelIndex: number) {
    const activeStoryboardId = String(storyboardPanelId ?? "").trim();
    if (!activeStoryboardId) return;

    setStoryboardRegeneratingIndex(panelIndex);
    setStoryboardRegenerateError(null);
    try {
      const res = await fetch(`/api/storyboards/${activeStoryboardId}/regenerate-panel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          panelIndex,
          ...(selectedProductId ? { productId: selectedProductId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.panel) {
        throw new Error(data?.error || "Failed to regenerate panel");
      }

      const regeneratedPanel = normalizeStoryboardPanel(data.panel, panelIndex);
      updateStoryboardDraftPanel(panelIndex, (panel) => ({
        ...regeneratedPanel,
        startTime: panel.startTime,
        endTime: panel.endTime,
        vo: panel.vo,
      }));
      toast.success(`Panel ${panelIndex + 1} regenerated.`);
    } catch (err: any) {
      setStoryboardRegenerateError(err?.message || "Failed to regenerate panel");
      toast.error(err?.message || "Failed to regenerate panel");
    } finally {
      setStoryboardRegeneratingIndex(null);
    }
  }

  async function handleSaveStoryboardEdits() {
    const activeStoryboardId = String(storyboardPanelId ?? "").trim();
    if (!activeStoryboardId) return;

    if (!storyboardDraftPanels.length) {
      setStoryboardSaveError("Storyboard must contain at least one panel.");
      return;
    }

    setStoryboardSaving(true);
    setStoryboardSaveError(null);
    try {
      const payloadPanels = storyboardDraftPanels.map((panel, index) =>
        normalizeStoryboardPanel(panel, index),
      );
      const res = await fetch(`/api/storyboards/${activeStoryboardId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          panels: payloadPanels,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.storyboard) {
        throw new Error(data?.error || "Failed to save storyboard");
      }
      const storyboard = data.storyboard as StoryboardDetails;
      const normalizedPanels = Array.isArray(storyboard.panels)
        ? storyboard.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
        : [];
      const validationReport = normalizeValidationReport(
        (data?.storyboard as Record<string, unknown> | undefined)?.validationReport,
      );
      setStoryboardPanelData({
        ...storyboard,
        panels: normalizedPanels,
        validationReport,
      });
      setStoryboardDraftPanels(normalizedPanels);
      setStoryboardEditMode(false);
      setStoryboardRegenerateError(null);
      toast.success("Storyboard updated.");
    } catch (err: any) {
      setStoryboardSaveError(err?.message || "Failed to save storyboard");
      toast.error(err?.message || "Failed to save storyboard");
    } finally {
      setStoryboardSaving(false);
    }
  }

  function buildVideoPromptDraftsFromPanels(panels: StoryboardPanel[]): string[] {
    return panels.map((panel) => String(panel.videoPrompt ?? "").trim());
  }

  function buildImagePromptDraftsFromPanels(
    panels: StoryboardPanel[],
  ): Array<{ firstFramePrompt: string; lastFramePrompt: string }> {
    return panels.map((panel) => ({
      firstFramePrompt: String(panel.firstFramePrompt ?? "").trim(),
      lastFramePrompt: String(panel.lastFramePrompt ?? "").trim(),
    }));
  }

  function openImagePromptEditMode() {
    const sourcePanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
      : [];
    setImagePromptDrafts(buildImagePromptDraftsFromPanels(sourcePanels));
    setImagePromptEditMode(true);
    setImagePromptSaveError(null);
  }

  function cancelImagePromptEditMode() {
    const sourcePanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
      : [];
    setImagePromptDrafts(buildImagePromptDraftsFromPanels(sourcePanels));
    setImagePromptEditMode(false);
    setImagePromptSaveError(null);
  }

  function updateImagePromptDraft(
    panelIndex: number,
    patch: Partial<{ firstFramePrompt: string; lastFramePrompt: string }>,
  ) {
    setImagePromptDrafts((prev) =>
      prev.map((entry, index) => (index === panelIndex ? { ...entry, ...patch } : entry)),
    );
  }

  async function handleSaveImagePromptEdits() {
    const activeStoryboardId = String(storyboardPanelId ?? "").trim();
    if (!activeStoryboardId) return;

    if (imagePromptDrafts.length === 0) {
      setImagePromptSaveError("No scenes available to save.");
      return;
    }

    setImagePromptSaving(true);
    setImagePromptSaveError(null);
    try {
      const payloadPrompts = imagePromptDrafts.map((entry, panelIndex) => ({
        panelIndex,
        firstFramePrompt: String(entry.firstFramePrompt ?? "").trim(),
        lastFramePrompt: String(entry.lastFramePrompt ?? "").trim(),
      }));
      const res = await fetch(`/api/storyboards/${activeStoryboardId}/image-prompts`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompts: payloadPrompts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save image prompts");
      }

      const promptUpdates = Array.isArray(data?.prompts)
        ? data.prompts
            .map((entry: any) => ({
              panelIndex: Number(entry?.panelIndex),
              firstFramePrompt:
                typeof entry?.firstFramePrompt === "string" ? entry.firstFramePrompt : "",
              lastFramePrompt: typeof entry?.lastFramePrompt === "string" ? entry.lastFramePrompt : "",
            }))
            .filter(
              (entry: { panelIndex: number; firstFramePrompt: string; lastFramePrompt: string }) =>
                Number.isInteger(entry.panelIndex),
            )
        : payloadPrompts;

      setStoryboardPanelData((prev) => {
        if (!prev || !Array.isArray(prev.panels)) return prev;
        const nextPanels = prev.panels.map((panel, panelIndex) => {
          const updated = promptUpdates.find(
            (entry: { panelIndex: number }) => entry.panelIndex === panelIndex,
          );
          if (!updated) return panel;
          return {
            ...panel,
            firstFramePrompt: String(updated.firstFramePrompt ?? "").trim() || null,
            lastFramePrompt: String(updated.lastFramePrompt ?? "").trim() || null,
          };
        });
        return {
          ...prev,
          panels: nextPanels,
        };
      });
      setImagePromptDrafts(
        payloadPrompts.map((entry) => ({
          firstFramePrompt: String(entry.firstFramePrompt ?? "").trim(),
          lastFramePrompt: String(entry.lastFramePrompt ?? "").trim(),
        })),
      );
      setImagePromptEditMode(false);
      toast.success("Image prompts updated.");
    } catch (err: any) {
      setImagePromptSaveError(err?.message || "Failed to save image prompts");
      toast.error(err?.message || "Failed to save image prompts");
    } finally {
      setImagePromptSaving(false);
    }
  }

  function openVideoPromptEditMode() {
    const sourcePanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
      : [];
    setVideoPromptDrafts(buildVideoPromptDraftsFromPanels(sourcePanels));
    setVideoPromptEditMode(true);
    setVideoPromptSaveError(null);
    setVideoPromptRegenerateError(null);
  }

  function cancelVideoPromptEditMode() {
    const sourcePanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
      : [];
    setVideoPromptDrafts(buildVideoPromptDraftsFromPanels(sourcePanels));
    setVideoPromptEditMode(false);
    setVideoPromptSaveError(null);
    setVideoPromptRegenerateError(null);
    setVideoPromptRegeneratingIndex(null);
  }

  function updateVideoPromptDraft(panelIndex: number, value: string) {
    setVideoPromptDrafts((prev) => prev.map((entry, index) => (index === panelIndex ? value : entry)));
  }

  async function handleSaveVideoPromptEdits() {
    const activeStoryboardId = String(storyboardPanelId ?? "").trim();
    if (!activeStoryboardId) return;

    if (videoPromptDrafts.length === 0) {
      setVideoPromptSaveError("No scenes available to save.");
      return;
    }

    setVideoPromptSaving(true);
    setVideoPromptSaveError(null);
    try {
      const payloadPrompts = videoPromptDrafts.map((videoPrompt, panelIndex) => ({
        panelIndex,
        videoPrompt,
      }));
      const res = await fetch(`/api/storyboards/${activeStoryboardId}/video-prompts`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompts: payloadPrompts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save video prompts");
      }

      const promptUpdates = Array.isArray(data?.prompts)
        ? data.prompts
            .map((entry: any) => ({
              panelIndex: Number(entry?.panelIndex),
              videoPrompt: typeof entry?.videoPrompt === "string" ? entry.videoPrompt : "",
            }))
            .filter((entry: { panelIndex: number; videoPrompt: string }) => Number.isInteger(entry.panelIndex))
        : payloadPrompts.map((entry) => ({
            panelIndex: entry.panelIndex,
            videoPrompt: String(entry.videoPrompt ?? "").trim(),
          }));

      setStoryboardPanelData((prev) => {
        if (!prev || !Array.isArray(prev.panels)) return prev;
        const nextPanels = prev.panels.map((panel, panelIndex) => {
          const updated = promptUpdates.find((entry: { panelIndex: number }) => entry.panelIndex === panelIndex);
          if (!updated) return panel;
          return {
            ...panel,
            videoPrompt: String(updated.videoPrompt ?? "").trim() || null,
          };
        });
        return {
          ...prev,
          panels: nextPanels,
        };
      });
      setVideoPromptDrafts(
        payloadPrompts.map((entry) => String(entry.videoPrompt ?? "").trim()),
      );
      setVideoPromptEditMode(false);
      setVideoPromptRegenerateError(null);
      toast.success("Video prompts updated.");
    } catch (err: any) {
      setVideoPromptSaveError(err?.message || "Failed to save video prompts");
      toast.error(err?.message || "Failed to save video prompts");
    } finally {
      setVideoPromptSaving(false);
    }
  }

  async function handleRegenerateVideoPrompt(panelIndex: number) {
    const activeStoryboardId = String(storyboardPanelId ?? "").trim();
    if (!activeStoryboardId) return;

    setVideoPromptRegeneratingIndex(panelIndex);
    setVideoPromptRegenerateError(null);
    try {
      const res = await fetch(`/api/storyboards/${activeStoryboardId}/regenerate-panel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          panelIndex,
          target: "video_prompt",
          ...(selectedProductId ? { productId: selectedProductId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.videoPrompt !== "string") {
        throw new Error(data?.error || "Failed to regenerate video prompt");
      }

      const regeneratedPrompt = data.videoPrompt.trim();
      updateVideoPromptDraft(panelIndex, regeneratedPrompt);
      setStoryboardPanelData((prev) => {
        if (!prev || !Array.isArray(prev.panels)) return prev;
        const nextPanels = prev.panels.map((panel, index) =>
          index === panelIndex
            ? {
                ...panel,
                videoPrompt: regeneratedPrompt || null,
              }
            : panel,
        );
        return {
          ...prev,
          panels: nextPanels,
        };
      });
      toast.success(`Video prompt ${panelIndex + 1} regenerated.`);
    } catch (err: any) {
      setVideoPromptRegenerateError(err?.message || "Failed to regenerate video prompt");
      toast.error(err?.message || "Failed to regenerate video prompt");
    } finally {
      setVideoPromptRegeneratingIndex(null);
    }
  }

  type PipelineJobDiagnostics = {
    activeRunJobs: Job[];
    allJobs: Job[];
    effectiveJobs: Job[];
    source: "selected_run" | "all_runs";
    status: ProductionStep["status"];
  };

  function sortJobsByRecency(rows: Job[]): Job[] {
    return [...rows].sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
    );
  }

  function deriveStepStatus(jobsOfType: Job[]): ProductionStep["status"] {
    if (jobsOfType.length === 0) return "not_started";
    const latest = jobsOfType[0];
    if (latest.status === JobStatus.RUNNING || latest.status === JobStatus.PENDING) return "running";
    if (latest.status === JobStatus.COMPLETED) return "completed";
    if (latest.status === JobStatus.FAILED) return "failed";
    return "not_started";
  }

  const pipelineJobDiagnosticsByType = useMemo(() => {
    const diagnostics = new Map<JobType, PipelineJobDiagnostics>();
    for (const jobType of PIPELINE_STEP_TYPES) {
      const activeRunJobs = sortJobsByRecency(jobsInActiveRun.filter((job) => job.type === jobType));
      const allJobs = sortJobsByRecency(jobs.filter((job) => job.type === jobType));
      const effectiveJobs = activeRunJobs.length > 0 ? activeRunJobs : allJobs;
      diagnostics.set(jobType, {
        activeRunJobs,
        allJobs,
        effectiveJobs,
        source: activeRunJobs.length > 0 ? "selected_run" : "all_runs",
        status: deriveStepStatus(effectiveJobs),
      });
    }
    return diagnostics;
  }, [jobs, jobsInActiveRun]);

  useEffect(() => {
    for (const jobType of PIPELINE_STEP_TYPES) {
      const diagnostics = pipelineJobDiagnosticsByType.get(jobType);
      if (!diagnostics) continue;
      console.log("[Creative][Pipeline] step status calculation", {
        jobType,
        selectedRunId,
        activeRunJobs: diagnostics.activeRunJobs.map((job) => ({
          id: job.id,
          status: job.status,
          runId: job.runId ?? null,
          createdAt: job.createdAt,
        })),
        allJobs: diagnostics.allJobs.map((job) => ({
          id: job.id,
          status: job.status,
          runId: job.runId ?? null,
          createdAt: job.createdAt,
        })),
        source: diagnostics.source,
        calculatedStatus: diagnostics.status,
      });
    }
  }, [pipelineJobDiagnosticsByType, selectedRunId]);

  function getJobsForType(type: JobType): Job[] {
    return pipelineJobDiagnosticsByType.get(type)?.effectiveJobs ?? [];
  }

  function getStepStatus(type: JobType): ProductionStep["status"] {
    return pipelineJobDiagnosticsByType.get(type)?.status ?? "not_started";
  }

  function hasCompletedJob(type: JobType): boolean {
    return getJobsForType(type).some((job) => job.status === JobStatus.COMPLETED);
  }

  function isStaleRunningJob(job: Job | undefined): boolean {
    if (!job || job.status !== JobStatus.RUNNING) return false;
    const updatedAtMs = Date.parse(job.updatedAt);
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs > STALE_RUNNING_JOB_MS;
  }

  const imagePromptLastJob = getJobsForType("IMAGE_PROMPT_GENERATION" as JobType)[0];
  const isImagePromptJobStuck = isStaleRunningJob(imagePromptLastJob);
  const latestVideoImageJob = getJobsForType(JobType.VIDEO_IMAGE_GENERATION)[0];
  const latestVideoImageJobSignature = latestVideoImageJob
    ? `${latestVideoImageJob.id}:${latestVideoImageJob.status}:${latestVideoImageJob.updatedAt}`
    : "";

  const storyboardPanelsForSceneFlow = useMemo(() => {
    if (!latestCompletedStoryboardId) return [] as StoryboardPanel[];
    if (!storyboardPanelData || storyboardPanelId !== latestCompletedStoryboardId) return [] as StoryboardPanel[];
    return Array.isArray(storyboardPanelData.panels) ? storyboardPanelData.panels : [];
  }, [latestCompletedStoryboardId, storyboardPanelData, storyboardPanelId]);

  const sceneFlowPanelByNumber = useMemo(() => {
    const map = new Map<number, StoryboardPanel>();
    for (const panel of storyboardPanelsForSceneFlow) {
      const sceneNumber = Number(panel.sceneNumber);
      if (!Number.isInteger(sceneNumber) || sceneNumber < 1) continue;
      map.set(sceneNumber, panel);
    }
    return map;
  }, [storyboardPanelsForSceneFlow]);

  const requiredSceneNumbers = [1, 2, 3, 4, 5, 6];
  const requiredScenePanels = requiredSceneNumbers.map((sceneNumber) =>
    sceneFlowPanelByNumber.get(sceneNumber) ?? null,
  );
  const allRequiredScenesApproved =
    requiredScenePanels.length === requiredSceneNumbers.length &&
    requiredScenePanels.every((panel) => Boolean(panel?.approved));
  const anyRequiredSceneGenerated = requiredScenePanels.some((panel) => Boolean(getSceneLastFrameImageUrl(panel)));

  const videoImagesDerivedStatus: ProductionStep["status"] = (() => {
    if (allRequiredScenesApproved) return "completed";
    const jobStatus = getStepStatus(JobType.VIDEO_IMAGE_GENERATION);
    if (sceneGeneratingNumber !== null || submitting === "video_images" || jobStatus === "running") {
      return "running";
    }
    if (jobStatus === "failed") return "failed";
    if (anyRequiredSceneGenerated) return "running";
    return "not_started";
  })();

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
      key: "image_prompts",
      label: "Generate Image Prompts",
      jobType: "IMAGE_PROMPT_GENERATION" as JobType,
      status: isImagePromptJobStuck
        ? "failed"
        : getStepStatus("IMAGE_PROMPT_GENERATION" as JobType),
      canRun: isImagePromptJobStuck || hasCompletedJob(JobType.STORYBOARD_GENERATION),
      locked: isImagePromptJobStuck ? false : !hasCompletedJob(JobType.STORYBOARD_GENERATION),
      lockReason: isImagePromptJobStuck ? undefined : "Create storyboard first",
      lastJob: imagePromptLastJob,
    },
    {
      key: "video_images",
      label: "Generate Images",
      jobType: JobType.VIDEO_IMAGE_GENERATION,
      status: videoImagesDerivedStatus,
      canRun:
        hasCompletedJob("IMAGE_PROMPT_GENERATION" as JobType) &&
        hasSelectedProductCreatorReference,
      locked:
        !hasCompletedJob("IMAGE_PROMPT_GENERATION" as JobType) ||
        !hasSelectedProductCreatorReference,
      lockReason: !hasCompletedJob("IMAGE_PROMPT_GENERATION" as JobType)
        ? "Generate image prompts first"
        : "Set an active creator face in product settings first",
      lastJob: latestVideoImageJob,
    },
    {
      key: "video_prompts",
      label: "Generate Video Prompts",
      jobType: JobType.VIDEO_PROMPT_GENERATION,
      status: getStepStatus(JobType.VIDEO_PROMPT_GENERATION),
      canRun: allRequiredScenesApproved,
      locked: !allRequiredScenesApproved,
      lockReason: "Approve scenes 1-6 first",
      lastJob: getJobsForType(JobType.VIDEO_PROMPT_GENERATION)[0],
    },
    {
      key: "video",
      label: "Generate Video",
      jobType: JobType.VIDEO_GENERATION,
      status: getStepStatus(JobType.VIDEO_GENERATION),
      canRun: hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      lockReason: "Generate prompts first",
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
  // ARCHIVED: Image generation replaced by Sora 2 Character Cameos.
  const visibleSteps = steps.filter(
    (step) => step.key !== "image_prompts" && step.key !== "video_images",
  );

  async function runStep(
    step: ProductionStep,
    extraPayload?: Record<string, unknown>
  ): Promise<boolean> {
    if (!step.canRun || step.locked) return false;
    if (!selectedProductId) {
      setError("Select or create a product first.");
      return false;
    }
    if (step.key === "video_images" && !hasSelectedProductCreatorReference) {
      setError(
        "Set an active creator face in product settings before generating images.",
      );
      return false;
    }

    setSubmitting(step.key);
    setError(null);

    try {
      const activeRunId = String(selectedRunId ?? "").trim();
      let endpoint = "";
      let payload: any = {
        ...(extraPayload || {}),
        // If a run is selected, pin jobs to it. If "No active run", omit runId so run-aware APIs create one.
        ...(activeRunId ? { runId: activeRunId } : {}),
        projectId,
        productId: selectedProductId,
      };

      // Map steps to their API endpoints
      const endpointMap: Record<string, string> = {
        script: "/api/jobs/script-generation",
        storyboard: "/api/jobs/storyboard-generation",
        image_prompts: "/api/jobs/image-prompts",
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

      if (
        step.key === "video_prompts" ||
        step.key === "video_images" ||
        step.key === "image_prompts"
      ) {
        const latestCompletedStoryboardJob = [...jobs]
          .filter(
            (job) =>
              job.type === JobType.STORYBOARD_GENERATION &&
              job.status === JobStatus.COMPLETED,
          )
          .sort(
            (a, b) =>
              new Date(b.updatedAt ?? b.createdAt).getTime() -
              new Date(a.updatedAt ?? a.createdAt).getTime(),
          )[0];
        const storyboardId = getStoryboardIdFromJob(latestCompletedStoryboardJob);
        if (!storyboardId) {
          throw new Error(
            "No completed storyboard found for this project. Run Create Storyboard first.",
          );
        }
        payload = {
          ...payload,
          storyboardId,
        };
      }

      console.log("[Creative] runStep request payload", {
        step: step.key,
        endpoint,
        selectedRunId,
        activeRunId: activeRunId || null,
        payloadRunId:
          typeof payload?.runId === "string" && payload.runId.trim()
            ? payload.runId
            : null,
        payload,
      });

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
      if (data?.runId) {
        setSelectedRunId(String(data.runId));
      }
      void loadProjectRuns();

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
    setScriptTargetDuration(30);
    setScriptBeatCount(5);
    setScriptNoResearchAcknowledged(false);
    setScriptModalError(null);
    setScriptModalSubmitting(false);
    setScriptRunSummary(null);
    setScriptRunSummaryLoading(false);
    setScriptRunSummaryError(null);
  }

  function isViewableCompletedStep(step: ProductionStep): boolean {
    return (
      step.status === "completed" &&
      (step.key === "storyboard" || step.key === "image_prompts" || step.key === "video_prompts")
    );
  }

  function isCompletedStepOutputExpanded(stepKey: string): boolean {
    return Boolean(expandedCompletedStepKeys[stepKey]);
  }

  function toggleCompletedStepOutput(stepKey: string) {
    setExpandedCompletedStepKeys((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey],
    }));
  }

  async function refreshStoryboardForOutput(storyboardId: string) {
    const targetId = String(storyboardId || "").trim();
    if (!targetId) return;
    setStoryboardPanelId(targetId);
    setStoryboardPanelLoading(true);
    setStoryboardPanelError(null);
    try {
      const res = await fetch(`/api/storyboards/${targetId}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.storyboard) {
        throw new Error(data?.error || "Failed to load storyboard panels");
      }
      const storyboard = data.storyboard as StoryboardDetails;
      const normalizedPanels = Array.isArray(storyboard.panels)
        ? storyboard.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
        : [];
      const validationReport = normalizeValidationReport(
        (data?.storyboard as Record<string, unknown> | undefined)?.validationReport,
      );
      setStoryboardPanelData({
        ...storyboard,
        panels: normalizedPanels,
        validationReport,
      });
      if (normalizedPanels.length === 0) {
        setStoryboardPanelError("Storyboard generation failed to produce output.");
      } else {
        setStoryboardPanelError(null);
      }
    } catch (err: any) {
      setStoryboardPanelData(null);
      setStoryboardPanelError(err?.message || "Failed to load storyboard panels");
    } finally {
      setStoryboardPanelLoading(false);
    }
  }

  useEffect(() => {
    const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
    if (!activeStoryboardId || !latestVideoImageJobSignature) return;
    void refreshStoryboardForOutput(activeStoryboardId);
  }, [
    latestCompletedStoryboardId,
    latestVideoImageJobSignature,
    storyboardPanelId,
  ]);

  function handleStepRunClick(step: ProductionStep) {
    if (step.key === "script") {
      resetScriptModal();
      setShowScriptModal(true);
      return;
    }
    if (isViewableCompletedStep(step) && !isCompletedStepOutputExpanded(step.key)) {
      if (step.key === "image_prompts") {
        const targetStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
        if (targetStoryboardId) {
          void refreshStoryboardForOutput(targetStoryboardId);
        }
      }
      toggleCompletedStepOutput(step.key);
      return;
    }
    void runStep(step);
  }

  function toggleSceneReview(sceneNumber: number) {
    setSceneReviewOpenByNumber((prev) => ({
      ...prev,
      [sceneNumber]: !prev[sceneNumber],
    }));
  }

  async function handleGenerateScene(sceneNumber: number) {
    const videoImagesStep = steps.find((step) => step.key === "video_images");
    if (!videoImagesStep) return;
    setSceneActionError(null);
    setSceneGeneratingNumber(sceneNumber);
    const ok = await runStep(videoImagesStep, {
      sceneNumber,
      runNonce: `scene-${sceneNumber}-${Date.now()}`,
    });
    if (ok) {
      setSceneReviewOpenByNumber((prev) => ({
        ...prev,
        [sceneNumber]: true,
      }));
      const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
      if (activeStoryboardId) {
        void refreshStoryboardForOutput(activeStoryboardId);
      }
    }
    setSceneGeneratingNumber(null);
  }

  async function handleApproveScene(sceneNumber: number) {
    const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
    if (!activeStoryboardId) {
      setSceneActionError("No storyboard found for scene approval.");
      return;
    }

    setSceneApprovingNumber(sceneNumber);
    setSceneActionError(null);
    try {
      const res = await fetch(
        `/api/storyboards/${activeStoryboardId}/scenes/${sceneNumber}/approval`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved: true }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to approve scene");
      }
      await refreshStoryboardForOutput(activeStoryboardId);
      toast.success(`Scene ${sceneNumber} approved.`);
    } catch (err: any) {
      const message = err?.message || "Failed to approve scene";
      setSceneActionError(message);
      toast.error(message);
    } finally {
      setSceneApprovingNumber(null);
    }
  }

  async function handleResetVideoImageJob(jobId: string) {
    const normalizedJobId = String(jobId || "").trim();
    if (!normalizedJobId || resettingVideoImageJobId) return;

    setSceneActionError(null);
    setResettingVideoImageJobId(normalizedJobId);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(normalizedJobId)}/reset`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to reset running image job");
      }

      await loadJobs(selectedProductId);
      await loadProjectRuns();
      toast.success("Running image job reset.");
    } catch (err: any) {
      const message = err?.message || "Failed to reset running image job";
      setSceneActionError(message);
      toast.error(message);
    } finally {
      setResettingVideoImageJobId(null);
    }
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

  const loadScriptRunSummary = useCallback(async (runId: string): Promise<ScriptRunSummary> => {
    const res = await fetch(`/api/projects/${projectId}/run-summary/${runId}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || "Failed to load selected run summary");
    }
    return data as ScriptRunSummary;
  }, [projectId]);

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

  useEffect(() => {
    if (scriptModalMode !== "ai") return;

    if (!selectedScriptResearchJobId) {
      setScriptRunSummary(null);
      setScriptRunSummaryLoading(false);
      setScriptRunSummaryError(null);
      return;
    }

    const selectedResearchRun =
      scriptResearchRuns.find((run) => run.jobId === selectedScriptResearchJobId) ?? null;
    const selectedRunId = String(selectedResearchRun?.runId ?? "").trim();

    if (!selectedRunId) {
      setScriptRunSummary(null);
      setScriptRunSummaryLoading(false);
      setScriptRunSummaryError("Selected research run is missing runId.");
      return;
    }

    let cancelled = false;
    setScriptRunSummaryLoading(true);
    setScriptRunSummaryError(null);

    void (async () => {
      try {
        const summary = await loadScriptRunSummary(selectedRunId);
        if (cancelled) return;
        setScriptRunSummary(summary);
      } catch (err: any) {
        if (cancelled) return;
        setScriptRunSummary(null);
        setScriptRunSummaryError(err?.message || "Failed to load selected run summary");
      } finally {
        if (cancelled) return;
        setScriptRunSummaryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadScriptRunSummary, scriptModalMode, scriptResearchRuns, selectedScriptResearchJobId]);

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
    const scriptGenerationPayload: Record<string, unknown> = {
      forceNew: true,
      targetDuration: scriptTargetDuration,
      beatCount: scriptBeatCount,
      ...(selectedScriptResearchJobId
        ? { customerAnalysisJobId: selectedScriptResearchJobId }
        : {}),
    };
    const ok = await runStep(
      scriptStep,
      scriptGenerationPayload
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
      const activeRunId = String(selectedRunId ?? "").trim();
      const res = await fetch("/api/jobs/script-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          productId: selectedProductId,
          ...(activeRunId ? { runId: activeRunId } : {}),
          scriptText: text,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      if (data?.runId) {
        setSelectedRunId(String(data.runId));
      }
      void loadProjectRuns();
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

  const handleRunsChanged = useCallback(
    async (event: { type: "renamed" | "deleted"; runId: string }) => {
      if (event.type === "deleted" && selectedRunId === event.runId) {
        setSelectedRunId(null);
      }
      await loadProjectRuns();
      await loadJobs(selectedProductId);
    },
    [loadJobs, loadProjectRuns, selectedProductId, selectedRunId],
  );

  async function handleCleanupOrphanedJobs() {
    if (cleaningOrphanedJobs || orphanedJobsCount <= 0) return;
    const confirmed = window.confirm(
      `Delete ${orphanedJobsCount} orphaned jobs? This cannot be undone.`,
    );
    if (!confirmed) return;

    setCleaningOrphanedJobs(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs/orphans`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Server returned ${res.status}`);
      }
      const deletedCount = Number(data?.deletedCount ?? 0);
      await loadJobs(selectedProductId);
      await loadProjectRuns();
      toast.success(`Deleted ${deletedCount} orphaned job${deletedCount === 1 ? "" : "s"}.`);
    } catch (err: any) {
      setError(err?.message || "Failed to clean up orphaned jobs");
      toast.error(err?.message || "Failed to clean up orphaned jobs");
    } finally {
      setCleaningOrphanedJobs(false);
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

  if (selectedProduct && !hasSelectedProductSoraCharacter) {
    return (
      <div className="px-6 py-6 space-y-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
          <h1 className="text-2xl font-semibold text-slate-50">Creative Studio</h1>
          <p className="text-sm text-slate-300 mt-1">
            Character setup is required before generating videos.
          </p>
        </section>
        <div className="rounded-lg bg-red-500/10 border border-red-500/50 p-4">
          <p className="text-sm text-red-200">
            Complete product setup to create your Sora character before using Creative Studio.
          </p>
          <Link
            href={`/products/${selectedProduct.id}`}
            className="mt-2 inline-flex items-center text-xs font-medium text-red-300 hover:text-red-200"
          >
            Go to Product Setup →
          </Link>
        </div>
      </div>
    );
  }

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

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select
            value={selectedRunId || "no-active"}
            onChange={(e) => {
              const value = e.target.value === "no-active" ? null : e.target.value;
              console.log("[Creative] run dropdown change", {
                selectedValue: e.target.value,
                nextRunId: value,
              });
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
          <div className="w-full md:w-auto" style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowRunManagerModal(true)}
              className="w-full md:w-auto rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
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
          {orphanedJobsCount > 0 && (
            <button
              type="button"
              onClick={() => void handleCleanupOrphanedJobs()}
              disabled={cleaningOrphanedJobs}
              className="w-full md:w-auto rounded-lg border border-red-500/60 bg-red-900/40 px-3 py-2 text-sm text-red-200 hover:bg-red-900/60"
              style={{
                cursor: cleaningOrphanedJobs ? "not-allowed" : "pointer",
                opacity: cleaningOrphanedJobs ? 0.7 : 1,
              }}
            >
              {cleaningOrphanedJobs
                ? "Cleaning Orphaned Jobs..."
                : `Clean Up Orphaned Jobs (${orphanedJobsCount})`}
            </button>
          )}
        </div>

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
          {visibleSteps.map((step, index) => {
            const scriptSources =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptResearchSources(step.lastJob.resultSummary)
                : null;
            const stepValidationReport =
              step.lastJob && step.status === "completed"
                ? getValidationReportFromResultSummary(step.lastJob.resultSummary)
                : null;
            const scriptId =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptIdFromResultSummary(step.lastJob.resultSummary)
                : null;
            const isScriptPanelOpen = Boolean(scriptId && scriptPanelOpenId === scriptId);
            const scriptValidationReport =
              step.key === "script" && isScriptPanelOpen && scriptPanelData
                ? getScriptValidationReportFromRawJson(scriptPanelData.rawJson) ?? stepValidationReport
                : stepValidationReport;
            const isStoryboardRelatedStep =
              step.key === "storyboard" ||
              step.key === "image_prompts" ||
              step.key === "video_prompts" ||
              step.key === "video_images";
            const storyboardId = isStoryboardRelatedStep
              ? (step.key === "storyboard" && step.lastJob
                  ? getStoryboardIdFromJob(step.lastJob)
                  : latestCompletedStoryboardId)
              : null;
            const storyboardMatchesCurrentFetch =
              Boolean(storyboardId && storyboardPanelId && storyboardId === storyboardPanelId);
            const storyboardPanels =
              storyboardMatchesCurrentFetch && storyboardPanelData?.panels
                ? storyboardPanelData.panels
                : [];
            const storyboardValidationReport =
              step.key === "storyboard"
                ? storyboardMatchesCurrentFetch
                  ? storyboardPanelData?.validationReport ?? stepValidationReport
                  : stepValidationReport
                : stepValidationReport;
            const isViewableCompleted = isViewableCompletedStep(step);
            const isOutputExpanded = isViewableCompleted && isCompletedStepOutputExpanded(step.key);
            const imagePromptRows =
              step.key === "image_prompts"
                ? storyboardPanels.map((panel, panelIndex) => ({
                    panelIndex,
                    sceneNumber: Number(panel.sceneNumber) || panelIndex + 1,
                    vo: String(panel.vo ?? "").trim(),
                    firstFramePrompt: String(panel.firstFramePrompt ?? "").trim(),
                    lastFramePrompt: String(panel.lastFramePrompt ?? "").trim(),
                  }))
                : [];
            const videoPromptRows =
              step.key === "video_prompts"
                ? storyboardPanels
                    .map((panel, panelIndex) => ({
                      panelIndex,
                      panelType: panel.panelType,
                      prompt: String(panel.videoPrompt ?? "").trim(),
                    }))
                : [];
            const sceneFlowRows =
              step.key === "video_images"
                ? [1, 2, 3, 4, 5, 6].map((sceneNumber) => {
                    const panel = storyboardPanels.find(
                      (candidate, panelIndex) =>
                        (Number(candidate.sceneNumber) || panelIndex + 1) === sceneNumber,
                    );
                    const previousPanel =
                      sceneNumber > 1
                        ? storyboardPanels.find(
                            (candidate, panelIndex) =>
                              (Number(candidate.sceneNumber) || panelIndex + 1) === sceneNumber - 1,
                          ) ?? null
                        : null;
                    const isLockedByPreviousScene =
                      sceneNumber > 1 && !Boolean(previousPanel?.approved);
                    const firstFrameImageUrl = String(panel?.firstFrameImageUrl || "").trim();
                    const lastFrameImageUrl = getSceneLastFrameImageUrl(panel);
                    const hasImages = Boolean(firstFrameImageUrl && lastFrameImageUrl);
                    return {
                      sceneNumber,
                      panel: panel ?? null,
                      firstFrameImageUrl: firstFrameImageUrl || null,
                      lastFrameImageUrl: lastFrameImageUrl || null,
                      approved: Boolean(panel?.approved),
                      hasImages,
                      locked: step.locked || isLockedByPreviousScene || !panel,
                      lockReason: !panel
                        ? "Scene missing from storyboard."
                        : step.locked
                          ? step.lockReason || "Blocked by pipeline prerequisites."
                          : isLockedByPreviousScene
                            ? `Approve Scene ${sceneNumber - 1} first.`
                            : undefined,
                      isReviewOpen: Boolean(sceneReviewOpenByNumber[sceneNumber]),
                    };
                  })
                : [];
            const isOutputViewMode = isViewableCompleted && !isOutputExpanded;
            const usesBottomOutputToggle = isViewableCompleted;
            const isVideoImagesStep = step.key === "video_images";
            const runningVideoImageJobId =
              isVideoImagesStep && step.lastJob?.status === JobStatus.RUNNING
                ? step.lastJob.id
                : null;
            const isResettingVideoImageJob =
              Boolean(runningVideoImageJobId) &&
              resettingVideoImageJobId === runningVideoImageJobId;
            const isStuckImagePromptStep =
              step.key === "image_prompts" && isStaleRunningJob(step.lastJob);
            const isPrimaryActionDisabled = isVideoImagesStep
              ? true
              : usesBottomOutputToggle
              ? !step.canRun || step.locked || step.status === "running" || submitting === step.key
              : isOutputViewMode
                ? submitting === step.key
                : !step.canRun || step.locked || step.status === "running" || submitting === step.key;
            const primaryActionLabel = isVideoImagesStep
              ? "Scene Controls"
              : submitting === step.key
              ? "Starting..."
              : usesBottomOutputToggle
                ? step.status === "completed"
                  ? "Re-run"
                  : step.status === "running"
                    ? "Running"
                    : "Run"
                : isOutputViewMode
                  ? "View Output"
                  : step.status === "completed"
                    ? "Re-run"
                    : step.status === "running"
                      ? "Running"
                      : "Run";
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
                  {!isVideoImagesStep ? (
                    <button
                      onClick={() => {
                        if (usesBottomOutputToggle) {
                          void runStep(step);
                          return;
                        }
                        handleStepRunClick(step);
                      }}
                      disabled={isPrimaryActionDisabled}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: "none",
                        backgroundColor:
                          isPrimaryActionDisabled
                            ? "#1e293b"
                            : "#0ea5e9",
                        color:
                          isPrimaryActionDisabled
                            ? "#64748b"
                            : "#ffffff",
                        cursor:
                          isPrimaryActionDisabled
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
                      {primaryActionLabel}
                    </button>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>Use scene controls below</span>
                      {runningVideoImageJobId && (
                        <button
                          type="button"
                          onClick={() => void handleResetVideoImageJob(runningVideoImageJobId)}
                          disabled={isResettingVideoImageJob}
                          style={{
                            border: "1px solid rgba(248, 113, 113, 0.6)",
                            backgroundColor: isResettingVideoImageJob ? "#1e293b" : "rgba(127, 29, 29, 0.3)",
                            color: isResettingVideoImageJob ? "#64748b" : "#fecaca",
                            borderRadius: 8,
                            padding: "8px 10px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: isResettingVideoImageJob ? "not-allowed" : "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isResettingVideoImageJob ? "Resetting..." : "Reset Running Job"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {step.locked && (
                <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#64748b" }}>🔒 {step.lockReason}</p>
              )}

              {isStuckImagePromptStep && (
                <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#fbbf24" }}>
                  Previous job stuck - click to retry
                </p>
              )}

              {step.lastJob && step.status !== "failed" && step.status !== "running" && (
                <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#94a3b8" }}>
                  {getSummaryText(step.lastJob.resultSummary)}
                </p>
              )}

              {step.status === "completed" &&
                (stepValidationReport?.warnings?.length ?? 0) > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid rgba(250, 204, 21, 0.4)",
                      backgroundColor: "rgba(250, 204, 21, 0.08)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fde68a" }}>
                      Quality warnings (Score: {stepValidationReport?.qualityScore ?? 0}/100)
                    </div>
                    <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                      {(stepValidationReport?.warnings ?? []).map((warning, warningIndex) => (
                        <div key={`step-warning-${step.key}-${warningIndex}`} style={{ fontSize: 12, color: "#fde68a" }}>
                          • {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {usesBottomOutputToggle && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => toggleCompletedStepOutput(step.key)}
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
                    {isOutputExpanded ? "Hide Output" : "View Output"}
                  </button>
                </div>
              )}

              {step.key === "video_images" && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    padding: 12,
                  }}
                >
                  {!storyboardId ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      No storyboard found for this run.
                    </p>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                      Loading scene flow...
                    </p>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{storyboardPanelError}</p>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 10px 0", color: "#94a3b8", fontSize: 12 }}>
                        Scenes 1-6 unlock sequentially. Scene N requires Scene N-1 approval.
                      </p>
                      {sceneActionError && (
                        <p style={{ margin: "0 0 10px 0", color: "#fca5a5", fontSize: 12 }}>
                          {sceneActionError}
                        </p>
                      )}
                      <div style={{ display: "grid", gap: 10 }}>
                        {sceneFlowRows.map((row) => {
                          const isGenerating = sceneGeneratingNumber === row.sceneNumber;
                          const isApproving = sceneApprovingNumber === row.sceneNumber;
                          const canReview = row.hasImages && !row.locked;
                          const canApprove = row.hasImages && !row.locked && !row.approved;
                          const firstFramePrompt = String(row.panel?.firstFramePrompt || "").trim();
                          const lastFramePrompt = String(row.panel?.lastFramePrompt || "").trim();
                          return (
                            <div
                              key={`scene-flow-${row.sceneNumber}`}
                              style={{
                                border: row.approved
                                  ? "1px solid rgba(16, 185, 129, 0.55)"
                                  : row.locked
                                    ? "1px solid #334155"
                                    : "1px solid rgba(14, 165, 233, 0.45)",
                                borderRadius: 8,
                                backgroundColor: "#0b1220",
                                padding: 10,
                                display: "grid",
                                gap: 8,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
                                  Scene {row.sceneNumber}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: row.approved
                                      ? "#6ee7b7"
                                      : row.locked
                                        ? "#94a3b8"
                                        : row.hasImages
                                          ? "#7dd3fc"
                                          : "#94a3b8",
                                  }}
                                >
                                  {row.approved
                                    ? "Approved"
                                    : row.locked
                                      ? "Locked"
                                      : row.hasImages
                                        ? "Ready"
                                        : "Awaiting Generation"}
                                </div>
                              </div>

                              {row.lockReason && (
                                <div style={{ color: "#94a3b8", fontSize: 11 }}>🔒 {row.lockReason}</div>
                              )}

                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => void handleGenerateScene(row.sceneNumber)}
                                  disabled={row.locked || isGenerating || sceneGeneratingNumber !== null || submitting === step.key}
                                  style={{
                                    border: "none",
                                    backgroundColor: row.locked || isGenerating ? "#1e293b" : "#0ea5e9",
                                    color: row.locked || isGenerating ? "#64748b" : "#ffffff",
                                    borderRadius: 7,
                                    padding: "6px 10px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: row.locked || isGenerating ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {isGenerating
                                    ? "Generating..."
                                    : row.hasImages
                                      ? "Re-generate"
                                      : "Generate"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSceneReview(row.sceneNumber)}
                                  disabled={!canReview}
                                  style={{
                                    border: "1px solid #334155",
                                    backgroundColor: "#0b1220",
                                    color: canReview ? "#cbd5e1" : "#64748b",
                                    borderRadius: 7,
                                    padding: "6px 10px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: canReview ? "pointer" : "not-allowed",
                                  }}
                                >
                                  {row.isReviewOpen ? "Hide Review" : "Review"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleApproveScene(row.sceneNumber)}
                                  disabled={!canApprove || isApproving}
                                  style={{
                                    border: "1px solid rgba(16, 185, 129, 0.5)",
                                    backgroundColor:
                                      row.approved
                                        ? "rgba(16, 185, 129, 0.2)"
                                        : canApprove && !isApproving
                                          ? "rgba(16, 185, 129, 0.15)"
                                          : "#0b1220",
                                    color: row.approved ? "#6ee7b7" : canApprove ? "#a7f3d0" : "#64748b",
                                    borderRadius: 7,
                                    padding: "6px 10px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: !canApprove || isApproving ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {row.approved ? "Approved" : isApproving ? "Approving..." : "Approve"}
                                </button>
                              </div>

                              {row.isReviewOpen && row.hasImages && (
                                <div style={{ display: "grid", gap: 8 }}>
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                      gap: 8,
                                    }}
                                  >
                                    <div>
                                      <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>First Frame</div>
                                      {row.firstFrameImageUrl ? (
                                        <img
                                          src={row.firstFrameImageUrl}
                                          alt={`Scene ${row.sceneNumber} first frame`}
                                          style={{
                                            width: "100%",
                                            borderRadius: 8,
                                            border: "1px solid #334155",
                                            display: "block",
                                          }}
                                        />
                                      ) : (
                                        <div style={{ color: "#94a3b8", fontSize: 11 }}>No first frame image.</div>
                                      )}
                                    </div>
                                    <div>
                                      <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Last Frame</div>
                                      {row.lastFrameImageUrl ? (
                                        <img
                                          src={row.lastFrameImageUrl}
                                          alt={`Scene ${row.sceneNumber} last frame`}
                                          style={{
                                            width: "100%",
                                            borderRadius: 8,
                                            border: "1px solid #334155",
                                            display: "block",
                                          }}
                                        />
                                      ) : (
                                        <div style={{ color: "#94a3b8", fontSize: 11 }}>No last frame image.</div>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ color: "#94a3b8", fontSize: 11 }}>First Frame Prompt</div>
                                  <div style={{ color: "#e2e8f0", fontSize: 12 }}>
                                    {firstFramePrompt || "No first-frame prompt."}
                                  </div>
                                  <div style={{ color: "#94a3b8", fontSize: 11 }}>Last Frame Prompt</div>
                                  <div style={{ color: "#e2e8f0", fontSize: 12 }}>
                                    {lastFramePrompt || "No last-frame prompt."}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
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
                      {scriptValidationReport && (
                        <div
                          style={{
                            marginBottom: 10,
                            borderRadius: 8,
                            border: "1px solid #334155",
                            backgroundColor: "#0b1220",
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>
                            Validation score: {scriptValidationReport.qualityScore}/100
                          </div>
                          {scriptValidationReport.warnings.length > 0 ? (
                            <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                              {scriptValidationReport.warnings.map((warning, warningIndex) => (
                                <div
                                  key={`script-validation-warning-${warningIndex}`}
                                  style={{ fontSize: 12, color: "#fde68a" }}
                                >
                                  • {warning}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#6ee7b7" }}>
                              All quality gates passed.
                            </div>
                          )}
                        </div>
                      )}
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
                            <div key={`${sceneIndex}-${scene.beat}`}>
                              <div
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
                                    gap: 10,
                                  }}
                                >
                                  {scriptPanelEditMode ? (
                                    <input
                                      type="text"
                                      value={scene.beat}
                                      onChange={(e) =>
                                        setScriptPanelDraftBeats((prev) =>
                                          prev.map((beat, idx) =>
                                            idx === sceneIndex ? { ...beat, beat: e.target.value } : beat
                                          )
                                        )
                                      }
                                      style={{
                                        flex: 1,
                                        minWidth: 140,
                                        borderRadius: 8,
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#e2e8f0",
                                        padding: "6px 8px",
                                        fontSize: 13,
                                        fontWeight: 600,
                                      }}
                                      placeholder={`Beat ${sceneIndex + 1}`}
                                    />
                                  ) : (
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                                      {scene.beat}
                                    </p>
                                  )}
                                  <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
                                    {formatSceneDuration(scene.duration)}
                                  </span>
                                  {scene.aiDataQuality === "partial" && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "#fef08a",
                                        border: "1px solid rgba(234, 179, 8, 0.55)",
                                        backgroundColor: "rgba(234, 179, 8, 0.12)",
                                        borderRadius: 999,
                                        padding: "2px 8px",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      Limited research data.
                                    </span>
                                  )}
                                  {scene.aiDataQuality === "minimal" && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "#fdba74",
                                        border: "1px solid rgba(249, 115, 22, 0.55)",
                                        backgroundColor: "rgba(249, 115, 22, 0.12)",
                                        borderRadius: 999,
                                        padding: "2px 8px",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      No research data — review carefully.
                                    </span>
                                  )}
                                  {scriptPanelEditMode && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveBeat(sceneIndex, "up")}
                                        disabled={sceneIndex === 0 || scriptPanelSaving}
                                        style={{
                                          border: "1px solid #334155",
                                          backgroundColor: "#0f172a",
                                          color: sceneIndex === 0 || scriptPanelSaving ? "#64748b" : "#cbd5e1",
                                          padding: "4px 8px",
                                          borderRadius: 6,
                                          fontSize: 12,
                                          cursor:
                                            sceneIndex === 0 || scriptPanelSaving ? "not-allowed" : "pointer",
                                        }}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveBeat(sceneIndex, "down")}
                                        disabled={sceneIndex === scriptPanelDraftBeats.length - 1 || scriptPanelSaving}
                                        style={{
                                          border: "1px solid #334155",
                                          backgroundColor: "#0f172a",
                                          color:
                                            sceneIndex === scriptPanelDraftBeats.length - 1 || scriptPanelSaving
                                              ? "#64748b"
                                              : "#cbd5e1",
                                          padding: "4px 8px",
                                          borderRadius: 6,
                                          fontSize: 12,
                                          cursor:
                                            sceneIndex === scriptPanelDraftBeats.length - 1 || scriptPanelSaving
                                              ? "not-allowed"
                                              : "pointer",
                                        }}
                                      >
                                        ↓
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteBeat(sceneIndex)}
                                        disabled={scriptPanelDraftBeats.length <= 1 || scriptPanelSaving}
                                        style={{
                                          border: "1px solid rgba(239, 68, 68, 0.5)",
                                          backgroundColor: "rgba(239, 68, 68, 0.12)",
                                          color:
                                            scriptPanelDraftBeats.length <= 1 || scriptPanelSaving
                                              ? "#64748b"
                                              : "#fecaca",
                                          padding: "4px 8px",
                                          borderRadius: 6,
                                          fontSize: 12,
                                          cursor:
                                            scriptPanelDraftBeats.length <= 1 || scriptPanelSaving
                                              ? "not-allowed"
                                              : "pointer",
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
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
                                  <p
                                    style={{
                                      margin: 0,
                                      fontSize: 13,
                                      lineHeight: 1.5,
                                      color: "#cbd5e1",
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {scene.vo || "No spoken words"}
                                  </p>
                                )}
                              </div>
                              {scriptPanelEditMode && (
                                <div style={{ marginTop: 8 }}>
                                  <AddBeatExpansion
                                    afterIndex={sceneIndex}
                                    disabled={scriptPanelSaving}
                                    onWriteYourself={handleInsertBeatWriteYourself}
                                    onGenerateWithAi={handleInsertBeatGenerateWithAi}
                                  />
                                </div>
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

              {step.key === "storyboard" && step.status === "completed" && isOutputExpanded && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    padding: 12,
                  }}
                >
                  {!storyboardId ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      Storyboard generation failed to produce output.
                    </p>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                      Loading storyboard panels...
                    </p>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{storyboardPanelError}</p>
                  ) : storyboardPanels.length === 0 ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      Storyboard generation failed to produce output.
                    </p>
                  ) : (
                    <>
                      {storyboardValidationReport && (
                        <div
                          style={{
                            marginBottom: 10,
                            borderRadius: 8,
                            border: "1px solid #334155",
                            backgroundColor: "#0b1220",
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>
                            Validation score: {storyboardValidationReport.qualityScore}/100
                          </div>
                          {storyboardValidationReport.warnings.length > 0 ? (
                            <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                              {storyboardValidationReport.warnings.map((warning, warningIndex) => (
                                <div
                                  key={`storyboard-validation-warning-${warningIndex}`}
                                  style={{ fontSize: 12, color: "#fde68a" }}
                                >
                                  • {warning}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#6ee7b7" }}>
                              All quality gates passed.
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ marginBottom: 10, color: "#94a3b8", fontSize: 12 }}>
                        {storyboardEditMode
                          ? `${storyboardDraftPanels.length} panel(s) in edit mode`
                          : `${storyboardPanels.length} panel(s)`}
                      </div>

                      {storyboardSaveError && (
                        <p style={{ margin: "0 0 8px 0", color: "#fca5a5", fontSize: 12 }}>{storyboardSaveError}</p>
                      )}
                      {storyboardRegenerateError && (
                        <p style={{ margin: "0 0 8px 0", color: "#fca5a5", fontSize: 12 }}>
                          {storyboardRegenerateError}
                        </p>
                      )}

                      <div style={{ display: "grid", gap: 10 }}>
                        {(storyboardEditMode ? storyboardDraftPanels : storyboardPanels).map((panel, panelIndex) => (
                          <div
                            key={`${panel.beatLabel}-${panel.startTime}-${panel.endTime}-${panelIndex}`}
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
                                gap: 10,
                                marginBottom: 8,
                              }}
                            >
                              <p style={{ margin: 0, color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
                                {panel.panelType === "B_ROLL_ONLY"
                                  ? "B-ROLL SEQUENCE"
                                  : panel.beatLabel || `Beat ${panelIndex + 1}`}
                              </p>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#94a3b8", fontSize: 12 }}>
                                  {formatStoryboardPanelTiming(panel)}
                                </span>
                                {storyboardEditMode && (
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStoryboardPanel(panelIndex, -1)}
                                      disabled={panelIndex === 0 || storyboardSaving}
                                      style={{
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#cbd5e1",
                                        padding: "2px 8px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        cursor:
                                          panelIndex === 0 || storyboardSaving ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveStoryboardPanel(panelIndex, 1)}
                                      disabled={
                                        panelIndex === storyboardDraftPanels.length - 1 || storyboardSaving
                                      }
                                      style={{
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#cbd5e1",
                                        padding: "2px 8px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        cursor:
                                          panelIndex === storyboardDraftPanels.length - 1 || storyboardSaving
                                            ? "not-allowed"
                                            : "pointer",
                                      }}
                                    >
                                      ↓
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteStoryboardPanel(panelIndex)}
                                      disabled={storyboardDraftPanels.length <= 1 || storyboardSaving}
                                      style={{
                                        border: "1px solid rgba(239, 68, 68, 0.5)",
                                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                                        color: "#fca5a5",
                                        padding: "2px 8px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        cursor:
                                          storyboardDraftPanels.length <= 1 || storyboardSaving
                                            ? "not-allowed"
                                            : "pointer",
                                      }}
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRegenerateStoryboardPanel(panelIndex)}
                                      disabled={storyboardRegeneratingIndex === panelIndex || storyboardSaving}
                                      style={{
                                        border: "1px solid rgba(14, 165, 233, 0.5)",
                                        backgroundColor: "rgba(14, 165, 233, 0.15)",
                                        color: "#7dd3fc",
                                        padding: "2px 8px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        cursor:
                                          storyboardRegeneratingIndex === panelIndex || storyboardSaving
                                            ? "not-allowed"
                                            : "pointer",
                                      }}
                                    >
                                      {storyboardRegeneratingIndex === panelIndex
                                        ? "Regenerating..."
                                        : "Regenerate Panel"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {storyboardEditMode ? (
                              <div style={{ display: "grid", gap: 8 }}>
                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Panel Type</div>
                                  <select
                                    value={panel.panelType}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        panelType: e.target.value === "B_ROLL_ONLY" ? "B_ROLL_ONLY" : "ON_CAMERA",
                                      }))
                                    }
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                    }}
                                  >
                                    <option value="ON_CAMERA">On Camera</option>
                                    <option value="B_ROLL_ONLY">B-roll Only</option>
                                  </select>
                                </div>
                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Beat Label</div>
                                  <textarea
                                    value={panel.beatLabel}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        beatLabel: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: 11 }}>
                                  Timing: {formatStoryboardPanelTiming(panel)}
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: 11 }}>VO</div>
                                <textarea
                                  value={panel.vo}
                                  readOnly
                                  rows={2}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    borderRadius: 8,
                                    border: "1px solid #1e293b",
                                    backgroundColor: "#020617",
                                    color: "#94a3b8",
                                    padding: 8,
                                    fontSize: 12,
                                    resize: "vertical",
                                  }}
                                />

                                {panel.panelType !== "B_ROLL_ONLY" && (
                                  <div>
                                    <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Character Action</div>
                                    <textarea
                                      value={panel.characterAction ?? ""}
                                      onChange={(e) =>
                                        updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                          ...prev,
                                          characterAction: e.target.value.trim() ? e.target.value : null,
                                        }))
                                      }
                                      rows={2}
                                      style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        borderRadius: 8,
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#e2e8f0",
                                        padding: 8,
                                        fontSize: 12,
                                        resize: "vertical",
                                      }}
                                    />
                                  </div>
                                )}

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Environment</div>
                                  <textarea
                                    value={panel.environment ?? ""}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        environment: e.target.value.trim() ? e.target.value : null,
                                      }))
                                    }
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Camera Direction</div>
                                  <textarea
                                    value={panel.cameraDirection}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        cameraDirection: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Product Placement</div>
                                  <textarea
                                    value={panel.productPlacement}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        productPlacement: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Transition Type</div>
                                  <textarea
                                    value={panel.transitionType}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        transitionType: e.target.value,
                                      }))
                                    }
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                                    {panel.panelType === "B_ROLL_ONLY"
                                      ? "B-roll Shot Breakdown (one per line)"
                                      : "B-roll Suggestions (one per line)"}
                                  </div>
                                  <textarea
                                    value={bRollSuggestionsToTextarea(panel.bRollSuggestions)}
                                    onChange={(e) =>
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        bRollSuggestions: parseBrollSuggestionsTextarea(e.target.value),
                                      }))
                                    }
                                    rows={panel.panelType === "B_ROLL_ONLY" ? 8 : 3}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border:
                                        panel.panelType === "B_ROLL_ONLY"
                                          ? "1px solid rgba(14, 165, 233, 0.6)"
                                          : "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                </div>

                                <div style={{ marginTop: 2 }}>
                                  <button
                                    type="button"
                                    onClick={() => handleAddStoryboardPanel(panelIndex)}
                                    disabled={storyboardSaving}
                                    style={{
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#cbd5e1",
                                      padding: "6px 10px",
                                      borderRadius: 8,
                                      fontSize: 12,
                                      cursor: storyboardSaving ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    Add Panel Below
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "grid", gap: 6, fontSize: 12, color: "#cbd5e1" }}>
                                {panel.panelType === "B_ROLL_ONLY" ? (
                                  <>
                                    <div>
                                      <strong style={{ color: "#f1f5f9" }}>B-roll Suggestions:</strong>
                                      {panel.bRollSuggestions.length > 0 ? (
                                        <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
                                          {panel.bRollSuggestions.map((suggestion, suggestionIndex) => (
                                            <div key={`broll-${panelIndex}-${suggestionIndex}`}>• {suggestion}</div>
                                          ))}
                                        </div>
                                      ) : (
                                        " Not provided"
                                      )}
                                    </div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Camera Direction:</strong> {panel.cameraDirection || "Not provided"}</div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Product Placement:</strong> {panel.productPlacement || "Not provided"}</div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Transition Type:</strong> {panel.transitionType || "Not provided"}</div>
                                  </>
                                ) : (
                                  <>
                                    <div><strong style={{ color: "#f1f5f9" }}>Character Action:</strong> {panel.characterAction || "Not provided"}</div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Environment:</strong> {panel.environment || "Not provided"}</div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Camera Direction:</strong> {panel.cameraDirection || "Not provided"}</div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Product Placement:</strong> {panel.productPlacement || "Not provided"}</div>
                                    <div>
                                      <strong style={{ color: "#f1f5f9" }}>B-roll Suggestions:</strong>{" "}
                                      {panel.bRollSuggestions.length > 0
                                        ? panel.bRollSuggestions.join(", ")
                                        : "Not provided"}
                                    </div>
                                    <div><strong style={{ color: "#f1f5f9" }}>Transition Type:</strong> {panel.transitionType || "Not provided"}</div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          justifyContent: "flex-start",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {!storyboardEditMode ? (
                          <button
                            type="button"
                            onClick={openStoryboardEditMode}
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
                            Edit Storyboard
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={cancelStoryboardEditMode}
                              disabled={storyboardSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: storyboardSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: storyboardSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveStoryboardEdits()}
                              disabled={storyboardSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: storyboardSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: storyboardSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              {storyboardSaving ? "Saving..." : "Save Storyboard"}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {step.key === "image_prompts" && step.status === "completed" && isOutputExpanded && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    padding: 12,
                  }}
                >
                  {!storyboardId ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      No storyboard found for this completed run.
                    </p>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                      Loading generated image prompts...
                    </p>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{storyboardPanelError}</p>
                  ) : imagePromptRows.length === 0 ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      No storyboard scenes available for image prompts.
                    </p>
                  ) : (
                    <>
                      <div style={{ marginBottom: 10, color: "#94a3b8", fontSize: 12 }}>
                        {imagePromptEditMode
                          ? `${imagePromptDrafts.length} scene prompt pair(s) in edit mode`
                          : `${imagePromptRows.length} scene prompt pair(s)`}
                      </div>

                      {imagePromptSaveError && (
                        <p style={{ margin: "0 0 8px 0", color: "#fca5a5", fontSize: 12 }}>
                          {imagePromptSaveError}
                        </p>
                      )}

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                          gap: 10,
                        }}
                      >
                        {imagePromptRows.map((row) => {
                          const draft = imagePromptDrafts[row.panelIndex] ?? {
                            firstFramePrompt: row.firstFramePrompt,
                            lastFramePrompt: row.lastFramePrompt,
                          };
                          const firstFramePrompt = imagePromptEditMode
                            ? String(draft.firstFramePrompt ?? "")
                            : row.firstFramePrompt;
                          const lastFramePrompt = imagePromptEditMode
                            ? String(draft.lastFramePrompt ?? "")
                            : row.lastFramePrompt;

                          return (
                            <div
                              key={`image-prompt-${row.panelIndex}`}
                              style={{
                                border: "1px solid #334155",
                                borderRadius: 8,
                                backgroundColor: "#0b1220",
                                padding: 10,
                                display: "grid",
                                gap: 8,
                              }}
                            >
                              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>
                                Scene {row.sceneNumber}
                              </div>
                              <div style={{ color: "#94a3b8", fontSize: 11 }}>VO Context</div>
                              <p
                                style={{
                                  margin: 0,
                                  color: "#cbd5e1",
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  backgroundColor: "#020617",
                                  border: "1px solid #1e293b",
                                  borderRadius: 8,
                                  padding: 8,
                                }}
                              >
                                {row.vo || "No VO available."}
                              </p>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                                    First Frame Prompt
                                  </div>
                                  {imagePromptEditMode ? (
                                    <textarea
                                      value={firstFramePrompt}
                                      onChange={(event) =>
                                        updateImagePromptDraft(row.panelIndex, {
                                          firstFramePrompt: event.target.value,
                                        })
                                      }
                                      disabled={imagePromptSaving}
                                      rows={3}
                                      style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        borderRadius: 8,
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#e2e8f0",
                                        padding: 8,
                                        fontSize: 12,
                                        resize: "vertical",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        color: "#e2e8f0",
                                        fontSize: 13,
                                        lineHeight: 1.5,
                                        backgroundColor: "#020617",
                                        border: "1px solid #1e293b",
                                        borderRadius: 8,
                                        padding: 8,
                                        minHeight: 64,
                                      }}
                                    >
                                      {firstFramePrompt || "No prompt generated yet."}
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                                    Last Frame Prompt
                                  </div>
                                  {imagePromptEditMode ? (
                                    <textarea
                                      value={lastFramePrompt}
                                      onChange={(event) =>
                                        updateImagePromptDraft(row.panelIndex, {
                                          lastFramePrompt: event.target.value,
                                        })
                                      }
                                      disabled={imagePromptSaving}
                                      rows={3}
                                      style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        borderRadius: 8,
                                        border: "1px solid #334155",
                                        backgroundColor: "#0f172a",
                                        color: "#e2e8f0",
                                        padding: 8,
                                        fontSize: 12,
                                        resize: "vertical",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        color: "#e2e8f0",
                                        fontSize: 13,
                                        lineHeight: 1.5,
                                        backgroundColor: "#020617",
                                        border: "1px solid #1e293b",
                                        borderRadius: 8,
                                        padding: 8,
                                        minHeight: 64,
                                      }}
                                    >
                                      {lastFramePrompt || "No prompt generated yet."}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          justifyContent: "flex-start",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {!imagePromptEditMode ? (
                          <button
                            type="button"
                            onClick={openImagePromptEditMode}
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
                            Edit Image Prompts
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={cancelImagePromptEditMode}
                              disabled={imagePromptSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: imagePromptSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: imagePromptSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveImagePromptEdits()}
                              disabled={imagePromptSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: imagePromptSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: imagePromptSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              {imagePromptSaving ? "Saving..." : "Save Image Prompts"}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {step.key === "video_prompts" && step.status === "completed" && isOutputExpanded && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    padding: 12,
                  }}
                >
                  {!storyboardId ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      No storyboard found for this completed run.
                    </p>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                      Loading generated video prompts...
                    </p>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>{storyboardPanelError}</p>
                  ) : videoPromptRows.length === 0 ? (
                    <p style={{ margin: 0, color: "#fca5a5", fontSize: 13 }}>
                      No storyboard scenes available for video prompts.
                    </p>
                  ) : (
                    <>
                      <div style={{ marginBottom: 10, color: "#94a3b8", fontSize: 12 }}>
                        {videoPromptEditMode
                          ? `${videoPromptDrafts.length} prompt(s) in edit mode`
                          : `${videoPromptRows.length} scene prompt(s)`}
                      </div>

                      {videoPromptSaveError && (
                        <p style={{ margin: "0 0 8px 0", color: "#fca5a5", fontSize: 12 }}>{videoPromptSaveError}</p>
                      )}
                      {videoPromptRegenerateError && (
                        <p style={{ margin: "0 0 8px 0", color: "#fca5a5", fontSize: 12 }}>
                          {videoPromptRegenerateError}
                        </p>
                      )}

                      <div style={{ display: "grid", gap: 10 }}>
                        {videoPromptRows.map((row) => {
                          const promptValue = videoPromptEditMode
                            ? String(videoPromptDrafts[row.panelIndex] ?? row.prompt)
                            : row.prompt;

                          return (
                            <div
                              key={`video-prompt-${row.panelIndex}`}
                              style={{
                                border: "1px solid #334155",
                                borderRadius: 8,
                                backgroundColor: "#0b1220",
                                padding: 10,
                                display: "grid",
                                gap: 8,
                              }}
                            >
                              <div style={{ color: "#94a3b8", fontSize: 11 }}>
                                Scene {row.panelIndex + 1} •{" "}
                                {row.panelType === "B_ROLL_ONLY" ? "B-roll" : "On camera"}
                              </div>
                              {videoPromptEditMode ? (
                                <>
                                  <textarea
                                    value={promptValue}
                                    onChange={(event) =>
                                      updateVideoPromptDraft(row.panelIndex, event.target.value)
                                    }
                                    disabled={videoPromptSaving}
                                    rows={3}
                                    style={{
                                      width: "100%",
                                      boxSizing: "border-box",
                                      borderRadius: 8,
                                      border: "1px solid #334155",
                                      backgroundColor: "#0f172a",
                                      color: "#e2e8f0",
                                      padding: 8,
                                      fontSize: 12,
                                      resize: "vertical",
                                    }}
                                  />
                                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <button
                                      type="button"
                                      onClick={() => void handleRegenerateVideoPrompt(row.panelIndex)}
                                      disabled={
                                        videoPromptRegeneratingIndex === row.panelIndex || videoPromptSaving
                                      }
                                      style={{
                                        border: "1px solid rgba(14, 165, 233, 0.5)",
                                        backgroundColor: "rgba(14, 165, 233, 0.15)",
                                        color: "#7dd3fc",
                                        padding: "4px 10px",
                                        borderRadius: 6,
                                        fontSize: 12,
                                        cursor:
                                          videoPromptRegeneratingIndex === row.panelIndex || videoPromptSaving
                                            ? "not-allowed"
                                            : "pointer",
                                      }}
                                    >
                                      {videoPromptRegeneratingIndex === row.panelIndex
                                        ? "Regenerating..."
                                        : "Regenerate"}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <p style={{ margin: 0, color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>
                                  {promptValue || "No prompt generated yet."}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          justifyContent: "flex-start",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {!videoPromptEditMode ? (
                          <button
                            type="button"
                            onClick={openVideoPromptEditMode}
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
                            Edit Video Prompts
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={cancelVideoPromptEditMode}
                              disabled={videoPromptSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: videoPromptSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: videoPromptSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveVideoPromptEdits()}
                              disabled={videoPromptSaving}
                              style={{
                                border: "1px solid #334155",
                                backgroundColor: "#0b1220",
                                color: videoPromptSaving ? "#64748b" : "#cbd5e1",
                                padding: "6px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: videoPromptSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              {videoPromptSaving ? "Saving..." : "Save Video Prompts"}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {step.status === "running" && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, color: "#7dd3fc" }}>
                  <Spinner />
                  <span style={{ fontSize: 12 }}>Processing...</span>
                </div>
              )}

              {hasSelectedRunWithJobs && step.status === "failed" && Boolean(step.lastJob?.error) && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 8,
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#fca5a5", margin: "0 0 4px 0" }}>Error Details:</p>
                      <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{getErrorText(step.lastJob?.error)}</p>
                    </div>
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
                          <div style={{ marginTop: 8 }}>
                            <p style={{ margin: 0, color: "#94a3b8", fontSize: 12 }}>
                              Selected analysis job: {selectedScriptResearchJobId}
                            </p>
                            {selectedScriptResearchRun?.runId && (
                              <p style={{ margin: "4px 0 0 0", color: "#94a3b8", fontSize: 12 }}>
                                Selected run: {selectedScriptResearchRun.runId}
                              </p>
                            )}

                            {scriptRunSummaryLoading ? (
                              <p style={{ margin: "10px 0 0 0", color: "#94a3b8", fontSize: 12 }}>
                                Loading source summary...
                              </p>
                            ) : scriptRunSummaryError ? (
                              <p style={{ margin: "10px 0 0 0", color: "#fca5a5", fontSize: 12 }}>
                                {scriptRunSummaryError}
                              </p>
                            ) : scriptRunSummary ? (
                              (() => {
                                const customer = getSourceRowContent(
                                  scriptRunSummary.customerAnalysis,
                                  String(scriptRunSummary.customerAnalysis.avatarSummary ?? "")
                                );
                                const pattern = getSourceRowContent(
                                  scriptRunSummary.patternAnalysis,
                                  ""
                                );
                                const productLabel = String(
                                  scriptRunSummary.productCollection.productName ?? ""
                                ).trim();
                                const productDate = scriptRunSummary.productCollection.completedAt
                                  ? formatMetadataDate(scriptRunSummary.productCollection.completedAt)
                                  : "";
                                const product = getSourceRowContent(
                                  scriptRunSummary.productCollection,
                                  [productLabel, productDate].filter(Boolean).join(" • ")
                                );
                                const rows = [
                                  { label: "Customer Analysis", value: customer.text, missing: customer.missing },
                                  { label: "Pattern Analysis", value: pattern.text, missing: pattern.missing },
                                  { label: "Product Collection", value: product.text, missing: product.missing },
                                ];

                                return (
                                  <div
                                    style={{
                                      marginTop: 10,
                                      border: "1px solid #334155",
                                      borderRadius: 10,
                                      backgroundColor: "#0b1220",
                                      padding: "8px 10px",
                                    }}
                                  >
                                    {rows.map((row) => (
                                      <div
                                        key={row.label}
                                        style={{
                                          display: "flex",
                                          alignItems: "flex-start",
                                          justifyContent: "space-between",
                                          gap: 12,
                                          padding: "6px 0",
                                          borderBottom: row.label === "Product Collection" ? "none" : "1px solid #1e293b",
                                        }}
                                      >
                                        <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>
                                          {row.label}
                                        </span>
                                        <span
                                          style={{
                                            color: row.missing ? "#fde68a" : "#94a3b8",
                                            fontSize: 12,
                                            textAlign: "right",
                                          }}
                                        >
                                          {row.missing ? `Warning: ${row.value}` : row.value}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 12,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>Duration</span>
                    <select
                      value={String(scriptTargetDuration)}
                      onChange={(e) => setScriptTargetDuration(Number(e.target.value))}
                      disabled={scriptModalSubmitting}
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid #334155",
                        backgroundColor: "#020617",
                        color: "#e2e8f0",
                        padding: "8px 10px",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    >
                      {[15, 30, 45, 60].map((seconds) => (
                        <option key={seconds} value={String(seconds)}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>Beats</span>
                    <select
                      value={String(scriptBeatCount)}
                      onChange={(e) => setScriptBeatCount(Number(e.target.value))}
                      disabled={scriptModalSubmitting}
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid #334155",
                        backgroundColor: "#020617",
                        color: "#e2e8f0",
                        padding: "8px 10px",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    >
                      {[3, 4, 5, 6].map((count) => (
                        <option key={count} value={String(count)}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
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
