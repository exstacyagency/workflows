// app/projects/[projectId]/creative-studio/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JobStatus, JobType } from "@prisma/client";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";
import RunManagementModal from "@/components/RunManagementModal";
import { analyzeSwipeTranscript, type SwipeAnalysis } from "@/lib/analyzeSwipeTranscript";
import { VideoEditorStep } from "./VideoEditorStep";

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
  characterUserName?: string | null;
  characters?: CharacterOption[];
};

type CharacterOption = {
  id: string;
  name: string;
  productId?: string;
  runId?: string | null;
  seedVideoUrl?: string | null;
  characterUserName?: string | null;
  soraCharacterId?: string | null;
  creatorVisualPrompt?: string | null;
  createdAt?: string | Date;
  productName?: string;
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
  description: string;
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
  aiDataQuality?: "full" | "partial" | "minimal" | null;
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

type ManualStoryboardPanelDraft = {
  beatLabel: string;
  startTime: string;
  endTime: string;
  vo: string;
  creatorAction: string;
  textOverlay: string;
  visualDescription: string;
  productPlacement: string;
};

const DEFAULT_SCRIPT_TARGET_DURATION_SECONDS = 30;
const PIPELINE_STEP_TYPES: JobType[] = [
  JobType.SCRIPT_GENERATION,
  JobType.STORYBOARD_GENERATION,
  "IMAGE_PROMPT_GENERATION" as JobType,
  JobType.VIDEO_IMAGE_GENERATION,
  JobType.VIDEO_PROMPT_GENERATION,
  JobType.VIDEO_GENERATION,
  JobType.VIDEO_REVIEW,
  JobType.VIDEO_UPSCALER,
];
const CREATIVE_JOB_TYPES = new Set<JobType>(PIPELINE_STEP_TYPES);

type ScriptRunSummarySource = {
  present: boolean;
  jobId: string | null;
  completedAt: string | null;
  avatarSummary?: string | null;
  productName?: string | null;
  formulaSummary?: string | null;
  formulaDetails?: {
    label: string | null;
    components: Array<{
      name: string;
      executionBrief: string;
    }>;
  } | null;
  psychologicalMechanism?: string | null;
  psychologicalMechanismDetails?: {
    label: string | null;
    executionBrief: string | null;
  } | null;
  summary?: string | null;
};

type SwipeRecommendationCandidate = {
  assetId: string;
  title: string | null;
  score: number;
  reasons: string[];
  metrics: {
    views: number | null;
    engagementScore: number | null;
    retention3s: number | null;
    retention10s: number | null;
    ctr: number | null;
  };
  sourceUrl: string | null;
  transcriptSnippet: string | null;
  ocrText: string | null;
  selectionSource: "swipe_file" | "run_ad";
  createdAt: string | null;
};

type ScriptRunSummary = {
  runId: string;
  customerAnalysis: ScriptRunSummarySource;
  patternAnalysis: ScriptRunSummarySource;
  productCollection: ScriptRunSummarySource;
  swipeRecommendation?: {
    present: boolean;
    recommendedAdId: string | null;
    sourceMode?: "swipe_file" | "run_ad";
    candidates: SwipeRecommendationCandidate[];
  };
};

type AddBeatExpansionProps = {
  afterIndex: number;
  disabled: boolean;
  onWriteYourself: (afterIndex: number, beatLabel: string) => void;
  onGenerateWithAi: (afterIndex: number, beatLabel: string) => Promise<void>;
};

const STALE_RUNNING_JOB_MS = 5 * 60 * 1000; // 5 minutes

type StoryboardPanel = {
  id?: string;
  sceneNumber?: number;
  panelType?: "ON_CAMERA" | "PRODUCT_ONLY" | "B_ROLL_ONLY";
  voiceoverOnly: boolean;
  beatLabel?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  vo?: string | null;
  characterAction?: string | null;
  characterName?: string | null;
  characterDescription?: string | null;
  characterAnchor?: string | null;
  characterHandle?: string | null;
  cameraDirection?: string | null;
  productPlacement?: string | null;
  bRollSuggestions?: string[] | null;
  environment?: string | null;
  videoPrompt?: string | null;
  videoUrl: string | null;
  approved?: boolean | null;
  status?: string | null;
  rawJson?: Record<string, unknown> | null;
  clipDurationSeconds?: number | null;
  firstFrameImageUrl?: string | null;
  lastFrameImageUrl?: string | null;
  firstFramePrompt?: string | null;
  lastFramePrompt?: string | null;
};

type StoryboardDetails = {
  id: string;
  status?: string | null;
  targetDuration?: number | null;
  panels: StoryboardPanel[];
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
      <div className="flex justify-end pr-2 py-4">
        <button
          onClick={handleToggleExpanded}
          disabled={disabled}
          className="btn btn-secondary !min-h-[28px] !px-4 text-[9px] uppercase font-bold tracking-[0.15em] border-line/50 hover:border-accent/40 transition-all flex items-center gap-2 group"
        >
          <span className="text-accent opacity-60 group-hover:opacity-100 transition-opacity text-xs">+</span>
          Start Workflow
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-panel p-6 space-y-5 animate-in fade-in zoom-in-95 duration-300">
      <div className="space-y-2">
         <span className="text-[9px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Node ID</span>
         <input
           type="text"
           value={label}
           onChange={(event) => {
             setLabel(event.target.value);
             setError(null);
           }}
           placeholder="Scene description"
           disabled={disabled || loading}
           className="w-full bg-panel border border-line/40 rounded-card px-4 py-2 text-[12px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all"
         />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleWriteYourself}
          disabled={disabled || loading}
          className="btn btn-secondary flex-1 !min-h-[36px] text-[9px] uppercase font-bold tracking-widest border-line/10"
        >
          Direct_Injection
        </button>
        <button
          onClick={() => void runGenerateWithAi()}
          disabled={disabled || loading}
          className="btn btn-primary flex-1 !min-h-[36px] text-[9px] uppercase font-bold tracking-widest gap-3"
        >
          {loading ? (
            <>
              <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Synthesizing...
            </>
          ) : (
            "Expansion"
          )}
        </button>
        <button
          onClick={handleToggleExpanded}
          disabled={disabled || loading}
          className="btn btn-secondary px-6 !min-h-[36px] text-[9px] uppercase font-bold tracking-widest opacity-40 hover:opacity-100"
        >
          Abort
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-card border border-danger/30 bg-danger/5 flex items-center justify-between gap-4 animate-in slide-in-from-top-2">
          <span className="text-[10px] font-mono text-danger uppercase tracking-widest">Error: {error}</span>
          <button
            onClick={() => void runGenerateWithAi()}
            disabled={disabled || loading}
            className="text-[9px] font-mono text-danger font-bold uppercase tracking-widest hover:underline"
          >
            Retry_Sync
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
  const [runCharacters, setRunCharacters] = useState<CharacterOption[]>([]);
  const [selectedStoryboardCharacterId, setSelectedStoryboardCharacterId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [showStoryboardModal, setShowStoryboardModal] = useState(false);
  const [storyboardModalMode, setStoryboardModalMode] = useState<"choose" | "manual">("choose");
  const [storyboardModalSubmitting, setStoryboardModalSubmitting] = useState(false);
  const [storyboardModalError, setStoryboardModalError] = useState<string | null>(null);
  const [manualStoryboardPanels, setManualStoryboardPanels] = useState<ManualStoryboardPanelDraft[]>([]);
  const [scriptModalMode, setScriptModalMode] = useState<"choose" | "ai" | "upload">("choose");
  const [scriptUploadText, setScriptUploadText] = useState("");
  const [scriptResearchRuns, setScriptResearchRuns] = useState<ResearchRunOption[]>([]);
  const [scriptRunsLoading, setScriptRunsLoading] = useState(false);
  const [selectedScriptResearchJobId, setSelectedScriptResearchJobId] = useState("");
  const [scriptGenerationStrategy, setScriptGenerationStrategy] = useState<
    "swipe_template" | "research_formula" | "upload_template"
  >("swipe_template");
  const [selectedSwipeTemplateAdId, setSelectedSwipeTemplateAdId] = useState<string>("");
  const [manualSwipeTemplateTitle, setManualSwipeTemplateTitle] = useState("");
  const [manualSwipeTemplateTranscript, setManualSwipeTemplateTranscript] = useState("");
  const [manualSwipeTemplateUploading, setManualSwipeTemplateUploading] = useState(false);
  const [swipeAnalysis, setSwipeAnalysis] = useState<SwipeAnalysis | null>(null);
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
  const [scriptPanelCombinedVoDraft, setScriptPanelCombinedVoDraft] = useState("");
  const [scriptPanelSaving, setScriptPanelSaving] = useState(false);
  const [storyboardPanelData, setStoryboardPanelData] = useState<StoryboardDetails | null>(null);
  const [storyboardPanelLoading, setStoryboardPanelLoading] = useState(false);
  const [storyboardPanelError, setStoryboardPanelError] = useState<string | null>(null);
  const [storyboardPanelId, setStoryboardPanelId] = useState<string | null>(null);
  const [storyboardEditMode, setStoryboardEditMode] = useState(false);
  const [storyboardDraftPanels, setStoryboardDraftPanels] = useState<StoryboardPanel[]>([]);
  const [storyboardBeatEditorDrafts, setStoryboardBeatEditorDrafts] = useState<string[]>([]);
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
  const [sceneVideoReviewOpenByNumber, setSceneVideoReviewOpenByNumber] = useState<Record<number, boolean>>({});
  const [sceneAdditionalInstructionsByNumber, setSceneAdditionalInstructionsByNumber] = useState<Record<number, string>>({});
  const [regenerateModalScene, setRegenerateModalScene] = useState<number | null>(null);
  const [, setMergedVideoUrl] = useState<string | null>(null);
  const [sceneGeneratingNumber, setSceneGeneratingNumber] = useState<number | null>(null);
  const [videoGeneratingNumber, setVideoGeneratingNumber] = useState<number | null>(null);
  const [sceneApprovingNumber, setSceneApprovingNumber] = useState<number | null>(null);
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({});
  const [sceneActionError, setSceneActionError] = useState<string | null>(null);
  const [resettingVideoImageJobId, setResettingVideoImageJobId] = useState<string | null>(null);
  const [cleaningOrphanedJobs, setCleaningOrphanedJobs] = useState(false);
  const [cancellingJobIds, setCancellingJobIds] = useState<Record<string, boolean>>({});
  const [expandedCompletedStepKeys, setExpandedCompletedStepKeys] = useState<Record<string, boolean>>({});
  const [showRunManagerModal, setShowRunManagerModal] = useState(false);
  const [showMissingProductImageWarning, setShowMissingProductImageWarning] = useState(false);
  const [characterPreview, setCharacterPreview] = useState<{ url: string; name: string } | null>(null);
  const [pendingVideoStep, setPendingVideoStep] = useState<ProductionStep | null>(null);
  const [projectRunsById, setProjectRunsById] = useState<Record<string, ProjectRunMetadata>>({});
  const selectedProductRef = useRef<string | null>(selectedProductIdFromUrl);
  const hasInitializedRunSelection = useRef(false);
  const storyboardFetchRef = useRef(0);

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

  const loadRunCharacters = useCallback(async () => {
    const activeRunId = String(selectedRunId ?? "").trim();
    const activeProductId = String(selectedProductId ?? "").trim();
    if (!projectId || !activeRunId) {
      setRunCharacters([]);
      setSelectedStoryboardCharacterId(null);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set("runId", activeRunId);
      if (activeProductId) params.set("productId", activeProductId);
      const res = await fetch(`/api/projects/${projectId}/characters?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(data)) {
        throw new Error("Failed to load run characters");
      }

      const mapped: CharacterOption[] = data.map((entry: any) => ({
        id: String(entry?.id ?? ""),
        name: String(entry?.name ?? "Character"),
        productId: String(entry?.productId ?? ""),
        runId: entry?.runId ? String(entry.runId) : null,
        seedVideoUrl:
          typeof entry?.seedVideoUrl === "string" && entry.seedVideoUrl.trim().length > 0
            ? entry.seedVideoUrl
            : null,
        characterUserName:
          typeof entry?.characterUserName === "string" ? entry.characterUserName : null,
        soraCharacterId:
          typeof entry?.soraCharacterId === "string" ? entry.soraCharacterId : null,
        createdAt:
          typeof entry?.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
        productName:
          typeof entry?.product?.name === "string"
            ? entry.product.name
            : (products.find((p) => p.id === String(entry?.productId ?? ""))?.name ?? "Product"),
        creatorVisualPrompt:
          typeof entry?.creatorVisualPrompt === "string" ? entry.creatorVisualPrompt : null,
      }));

      setRunCharacters(mapped);
      setSelectedStoryboardCharacterId((current) => {
        if (current && mapped.some((char) => char.id === current)) return current;
        return mapped[0]?.id ?? null;
      });
    } catch (err: any) {
      console.error("[Creative] Failed to load run characters", err);
      setRunCharacters([]);
      setSelectedStoryboardCharacterId(null);
    }
  }, [projectId, products, selectedProductId, selectedRunId]);

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

  useEffect(() => {
    void loadRunCharacters();
  }, [loadRunCharacters]);

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

  const isCancelableJob = useCallback((job: Job | null | undefined): boolean => {
    if (!job) return false;
    return job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING;
  }, []);

  const cancelJob = useCallback(
    async (jobId: string) => {
      setCancellingJobIds((prev) => ({ ...prev, [jobId]: true }));
      try {
        const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" && data.error.trim().length > 0
              ? data.error
              : "Failed to cancel job",
          );
        }
        toast.success("Job cancelled");
        await loadJobs(selectedProductId);
      } catch (err: any) {
        toast.error(err?.message || "Failed to cancel job");
      } finally {
        setCancellingJobIds((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
      }
    },
    [loadJobs, selectedProductId],
  );

  const runGroupsList = useMemo(() => Object.values(runGroups), [runGroups]);
  const selectedScriptResearchRun = useMemo(
    () => scriptResearchRuns.find((run) => run.jobId === selectedScriptResearchJobId) ?? null,
    [scriptResearchRuns, selectedScriptResearchJobId],
  );
  const scriptSwipeCandidates = scriptRunSummary?.swipeRecommendation?.candidates ?? [];
  const scriptSwipeFileCandidates = useMemo(
    () => scriptSwipeCandidates.filter((candidate) => candidate.selectionSource === "swipe_file"),
    [scriptSwipeCandidates],
  );
  const selectedSwipeCandidate =
    scriptSwipeCandidates.find((candidate) => candidate.assetId === selectedSwipeTemplateAdId) ?? null;
  const selectedSwipeFileCandidate =
    scriptSwipeFileCandidates.find((candidate) => candidate.assetId === selectedSwipeTemplateAdId) ?? null;
  const scriptGenerateDisabled =
    scriptModalSubmitting ||
    scriptRunsLoading ||
    (scriptResearchRuns.length > 0 ? !selectedScriptResearchJobId : !scriptNoResearchAcknowledged) ||
    (scriptGenerationStrategy === "swipe_template" &&
      scriptSwipeCandidates.length > 0 &&
      !selectedSwipeTemplateAdId) ||
    (scriptGenerationStrategy === "upload_template" &&
      scriptSwipeFileCandidates.length > 0 &&
      !selectedSwipeTemplateAdId);

  function getRunJobName(job: Job) {
    const payloadLabel =
      typeof job?.payload?.jobLabel === "string" ? String(job.payload.jobLabel).trim() : "";
    if (payloadLabel) return payloadLabel;
    const names: Record<string, string> = {
      SCRIPT_GENERATION: "Generate Script",
      STORYBOARD_GENERATION: "Create Storyboard",
      IMAGE_PROMPT_GENERATION: "Generate Image Prompts",
      VIDEO_PROMPT_GENERATION: "Generate Video Prompts",
      VIDEO_IMAGE_GENERATION: "Generate First Frames",
      VIDEO_GENERATION: "Generate Video",
      VIDEO_REVIEW: "Edit Video",
      VIDEO_UPSCALER: "Swap Audio",
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
  const recentCreativeJobs = useMemo(
    () =>
      jobs
        .filter((job) => CREATIVE_JOB_TYPES.has(job.type))
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt ?? b.createdAt).getTime() -
            new Date(a.updatedAt ?? a.createdAt).getTime()
        )
        .slice(0, 10),
    [jobs]
  );
  const orphanedJobsCount = useMemo(
    () => jobs.filter((job) => !String(job.runId ?? "").trim()).length,
    [jobs],
  );
  const jobsInActiveRun = useMemo(
    () => (selectedRunId ? selectedRunJobs : []),
    [selectedRunId, selectedRunJobs],
  );
  const generatedFirstFrameScenesInActiveRun = useMemo(() => {
    const sceneNumbers = new Set<number>();
    for (const job of jobsInActiveRun) {
      if (job.type !== JobType.VIDEO_IMAGE_GENERATION) continue;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : null;
      if (!payload) continue;
      const prompts = Array.isArray(payload.prompts) ? payload.prompts : [];
      for (const prompt of prompts) {
        const sceneNumber = Number((prompt as any)?.sceneNumber);
        if (Number.isInteger(sceneNumber) && sceneNumber > 0) {
          sceneNumbers.add(sceneNumber);
        }
      }
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      for (const task of tasks) {
        const sceneNumber = Number((task as any)?.sceneNumber);
        if (Number.isInteger(sceneNumber) && sceneNumber > 0) {
          sceneNumbers.add(sceneNumber);
        }
      }
    }
    return sceneNumbers;
  }, [jobsInActiveRun]);
  const latestFirstFrameGenerationBySceneInActiveRun = useMemo(() => {
    const latestByScene = new Map<number, number>();
    for (const job of jobsInActiveRun) {
      if (job.type !== JobType.VIDEO_IMAGE_GENERATION) continue;
      if (job.status !== JobStatus.COMPLETED) continue;
      const ts = new Date(job.updatedAt ?? job.createdAt).getTime();
      if (!Number.isFinite(ts)) continue;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : null;
      if (!payload) continue;
      const seenSceneNumbers = new Set<number>();
      const prompts = Array.isArray(payload.prompts) ? payload.prompts : [];
      for (const prompt of prompts) {
        const sceneNumber = Number((prompt as any)?.sceneNumber);
        if (Number.isInteger(sceneNumber) && sceneNumber > 0) {
          seenSceneNumbers.add(sceneNumber);
        }
      }
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      for (const task of tasks) {
        const sceneNumber = Number((task as any)?.sceneNumber);
        if (Number.isInteger(sceneNumber) && sceneNumber > 0) {
          seenSceneNumbers.add(sceneNumber);
        }
      }
      for (const sceneNumber of seenSceneNumbers) {
        const prev = latestByScene.get(sceneNumber) ?? 0;
        if (ts > prev) latestByScene.set(sceneNumber, ts);
      }
    }
    return latestByScene;
  }, [jobsInActiveRun]);
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );
  const selectedRunCharacter = useMemo(
    () => runCharacters.find((char) => char.id === selectedStoryboardCharacterId) ?? null,
    [runCharacters, selectedStoryboardCharacterId],
  );
  const allCharacters = useMemo(() => runCharacters, [runCharacters]);
  const hasSelectedProductCreatorReference = Boolean(
    String(selectedProduct?.creatorReferenceImageUrl ?? "").trim(),
  );
  const hasSelectedProductReferenceImage = Boolean(
    String(selectedProduct?.productReferenceImageUrl ?? "").trim(),
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
      if (selectedRunId) return null;
      return (
        jobs
          .filter(
            (job) => job.type === JobType.STORYBOARD_GENERATION && job.status === JobStatus.COMPLETED,
          )
          .sort(sortByNewest)[0] ?? null
      );
    },
    [jobs, jobsInActiveRun, selectedRunId],
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
    setRunCharacters([]);
    setSelectedStoryboardCharacterId(null);
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
    setSceneVideoReviewOpenByNumber({});
    setSceneAdditionalInstructionsByNumber({});
    setRegenerateModalScene(null);
    setSceneGeneratingNumber(null);
    setVideoGeneratingNumber(null);
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
      setSceneVideoReviewOpenByNumber({});
      setSceneGeneratingNumber(null);
      setVideoGeneratingNumber(null);
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
    setSceneVideoReviewOpenByNumber({});
    setSceneGeneratingNumber(null);
    setVideoGeneratingNumber(null);
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
        setStoryboardPanelData({
          ...storyboard,
          panels: normalizedPanels,
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

  function formatSwipeMetricPercent(value: number | null, digits = 1): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${(value * 100).toFixed(digits)}%`;
  }

  function formatSwipeMetricNumber(value: number | null, digits = 3): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return value.toFixed(digits);
  }

function getSummaryText(resultSummary: unknown, job?: Job | null): string {
  const sanitizeSummary = (value: string): string => {
    const cleaned = value
      .replace(/Video frames saved:/gi, "Video frames generated:")
        .replace(
          /Video generated:\s+\S+(?:\s+\(\+\d+\s+more\))?/gi,
          (match) => {
            const moreMatch = match.match(/\(\+(\d+)\s+more\)/i);
            const totalScenes = moreMatch ? Number(moreMatch[1]) + 1 : 1;
            return `Video scenes generated: ${totalScenes}`;
          },
        )
        .replace(/,?\s*scriptId=[^) ,]+/gi, "")
        .replace(/,?\s*words=\d+/gi, "")
        .replace(/\(\s*,\s*/g, "(")
        .replace(/\(\s*\)/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return cleaned;
    };
    const payloadObj =
      job?.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : null;
    if (job?.type === JobType.VIDEO_IMAGE_GENERATION && payloadObj) {
      const payloadTasks = Array.isArray(payloadObj.tasks) ? payloadObj.tasks : [];
      const payloadResult =
        payloadObj.result && typeof payloadObj.result === "object" && !Array.isArray(payloadObj.result)
          ? (payloadObj.result as Record<string, unknown>)
          : null;
      const resultImages = Array.isArray(payloadResult?.images) ? payloadResult.images : [];
      const successfulTaskCount = payloadTasks.filter((task) => {
        if (!task || typeof task !== "object" || Array.isArray(task)) return false;
        const url = String((task as Record<string, unknown>).url ?? "").trim();
        return Boolean(url);
      }).length;
      const generatedFrameCount = Math.max(resultImages.length, successfulTaskCount);
      if (generatedFrameCount > 0) {
        return `Video frames generated: ${generatedFrameCount}`;
      }
    }
    if (typeof resultSummary === "string" && resultSummary.trim()) {
      return sanitizeSummary(resultSummary);
    }
    if (resultSummary && typeof resultSummary === "object") {
      const summaryField = (resultSummary as Record<string, unknown>).summary;
      if (typeof summaryField === "string" && summaryField.trim()) {
        return sanitizeSummary(summaryField);
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

  function getSceneVideoUrl(panel: StoryboardPanel | null | undefined): string {
    if (!panel) return "";
    return String(panel.videoUrl || (panel.rawJson as any)?.videoUrl || (panel.rawJson as any)?.video_url || "").trim();
  }

function normalizeStoryboardPanel(panel: unknown, index: number): StoryboardPanel {
    const raw = panel && typeof panel === "object" ? (panel as Record<string, unknown>) : {};
    const asValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const panelTypeRaw = asValue(raw.panelType);
    const panelType =
      panelTypeRaw === "B_ROLL_ONLY"
        ? "B_ROLL_ONLY"
        : panelTypeRaw === "PRODUCT_ONLY"
          ? "PRODUCT_ONLY"
          : "ON_CAMERA";
    const characterAction =
      asValue(raw.characterAction) ||
      asValue(raw.creatorAction) ||
      asValue(raw["Character Action"]);
    const characterName = asValue(raw.characterName);
    const characterDescription = asValue(raw.characterDescription);
    const environment = asValue(raw.environment);
    const sceneNumberRaw = Number(raw.sceneNumber);
    const sceneNumber = Number.isFinite(sceneNumberRaw) && sceneNumberRaw > 0
      ? Math.trunc(sceneNumberRaw)
      : index + 1;
    return {
      sceneNumber,
      approved: Boolean(raw.approved),
      panelType,
      voiceoverOnly: Boolean((raw as any).voiceoverOnly ?? (raw as any).voiceover_only),
      beatLabel: `Beat ${index + 1}`,
      startTime: asValue(raw.startTime),
      endTime: asValue(raw.endTime),
      vo: asValue(raw.vo),
      firstFramePrompt: asValue(raw.firstFramePrompt) || null,
      lastFramePrompt: asValue(raw.lastFramePrompt) || null,
      firstFrameImageUrl:
        asValue(raw.firstFrameImageUrl) ||
        asValue(raw.firstFrameUrl) ||
        asValue(raw.first_frame_url) ||
        null,
      lastFrameImageUrl:
        asValue(raw.lastFrameImageUrl) ||
        asValue(raw.lastFrameUrl) ||
        asValue(raw.last_frame_url) ||
        null,
      videoPrompt: asValue(raw.videoPrompt) || null,
      videoUrl:
        asValue(raw.videoUrl) ||
        asValue(raw.video_url) ||
        null,
      characterAction: characterAction || null,
      characterName: characterName || null,
      characterDescription: characterDescription || null,
      environment: environment || null,
      cameraDirection: asValue(raw.cameraDirection),
      productPlacement: asValue(raw.productPlacement),
      bRollSuggestions: Array.isArray(raw.bRollSuggestions)
        ? raw.bRollSuggestions
            .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
            .filter((entry) => !/^character\s*handle\s*:/i.test(entry))
            .filter(Boolean)
        : [],
    };
  }

  function createEmptyStoryboardPanel(index: number, previousPanel?: StoryboardPanel): StoryboardPanel {
    const anchorTime = String(previousPanel?.endTime || previousPanel?.startTime || "0s").trim() || "0s";
    return {
      sceneNumber: index + 1,
      approved: false,
      panelType: "ON_CAMERA",
      voiceoverOnly: false,
      beatLabel: `Beat ${index + 1}`,
      startTime: anchorTime,
      endTime: anchorTime,
      vo: "",
      firstFramePrompt: null,
      lastFramePrompt: null,
      firstFrameImageUrl: null,
      lastFrameImageUrl: null,
      videoPrompt: null,
      videoUrl: null,
      characterAction: null,
      characterName: previousPanel?.characterName ?? null,
      characterDescription: previousPanel?.characterDescription ?? null,
      environment: null,
      cameraDirection: "",
      productPlacement: "",
      bRollSuggestions: [],
    };
  }

  function buildStoryboardBeatEditorText(panel: StoryboardPanel): string {
    const bRollLines = (panel.bRollSuggestions ?? []).length > 0
      ? (panel.bRollSuggestions ?? []).map((entry) => `- ${entry}`).join("\n")
      : "- ";
    return [
      `Character Name: ${panel.characterName ?? ""}`,
      `Character Description: ${panel.characterDescription ?? ""}`,
      `Character Action: ${panel.characterAction ?? ""}`,
      `Environment: ${panel.environment ?? ""}`,
      `Camera Direction: ${panel.cameraDirection ?? ""}`,
      `Product Placement: ${panel.productPlacement ?? ""}`,
      `B-roll Suggestions:\n${bRollLines}`,
    ].join("\n\n");
  }

  function buildStoryboardBeatEditorDraftsFromPanels(panels: StoryboardPanel[]): string[] {
    return panels.map((panel) => buildStoryboardBeatEditorText(panel));
  }

  useEffect(() => {
    if (!storyboardEditMode) return;
    setStoryboardBeatEditorDrafts((prev) =>
      storyboardDraftPanels.map((panel, index) => {
        if (typeof prev[index] === "string") return prev[index];
        return buildStoryboardBeatEditorText(panel);
      }),
    );
  }, [storyboardDraftPanels, storyboardEditMode]);

  function parseStoryboardBeatEditorText(
    value: string,
    fallbackPanel: StoryboardPanel,
  ): {
    characterName: string | null;
    characterDescription: string | null;
    characterAction: string | null;
    environment: string | null;
    cameraDirection: string;
    productPlacement: string;
    bRollSuggestions: string[];
  } {
    const labelMap: Array<{ label: string; key: string }> = [
      { label: "Character Name", key: "characterName" },
      { label: "Character Description", key: "characterDescription" },
      { label: "Character Action", key: "characterAction" },
      { label: "Environment", key: "environment" },
      { label: "Camera Direction", key: "cameraDirection" },
      { label: "Product Placement", key: "productPlacement" },
      { label: "B-roll Suggestions", key: "bRollSuggestions" },
    ];
    const sections: Record<string, string> = {};
    let activeKey: string | null = null;
    const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = rawLine;
      const matchedLabel = labelMap.find(({ label }) =>
        new RegExp(`^${label}\\s*:`, "i").test(line.trim()),
      );
      if (matchedLabel) {
        const content = line.replace(new RegExp(`^${matchedLabel.label}\\s*:`, "i"), "").trim();
        sections[matchedLabel.key] = content;
        activeKey = matchedLabel.key;
        continue;
      }
      if (!activeKey) continue;
      sections[activeKey] = sections[activeKey]
        ? `${sections[activeKey]}\n${line}`
        : line;
    }

    const parseNullable = (
      key: string,
      fallback: string | null,
      preserveFallbackWhenEmpty = false,
    ): string | null => {
      if (!(key in sections)) return fallback;
      const normalized = normalizeMultilineText(sections[key] ?? "");
      if (normalized) return normalized;
      return preserveFallbackWhenEmpty ? fallback : null;
    };

    const parseText = (key: string, fallback: string): string => {
      if (!(key in sections)) return fallback;
      return normalizeMultilineText(sections[key] ?? "");
    };

    const parseBroll = (): string[] => {
      if (!("bRollSuggestions" in sections)) return fallbackPanel.bRollSuggestions ?? [];
      return String(sections.bRollSuggestions ?? "")
        .split("\n")
        .map((entry) => entry.replace(/^\s*[-*]\s*/, "").trim())
        .filter(Boolean);
    };

    return {
      characterName: parseNullable("characterName", fallbackPanel.characterName ?? null),
      characterDescription: parseNullable(
        "characterDescription",
        fallbackPanel.characterDescription ?? null,
      ),
      characterAction: parseNullable(
        "characterAction",
        fallbackPanel.characterAction ?? null,
        true,
      ),
      environment: parseNullable("environment", fallbackPanel.environment ?? null),
      cameraDirection: parseText("cameraDirection", fallbackPanel.cameraDirection ?? ""),
      productPlacement: parseText("productPlacement", fallbackPanel.productPlacement ?? ""),
      bRollSuggestions: parseBroll(),
    };
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

  function getScriptIdFromJob(job: Job | null | undefined): string | null {
    if (!job) return null;

    const payload = job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : null;
    const payloadResult =
      payload?.result && typeof payload.result === "object"
        ? (payload.result as Record<string, unknown>)
        : null;

    const fromPayloadResult =
      typeof payloadResult?.scriptId === "string" && payloadResult.scriptId.trim()
        ? payloadResult.scriptId.trim()
        : null;
    if (fromPayloadResult) return fromPayloadResult;

    const fromPayload =
      typeof payload?.scriptId === "string" && payload.scriptId.trim()
        ? payload.scriptId.trim()
        : null;
    if (fromPayload) return fromPayload;

    return getScriptIdFromResultSummary(job.resultSummary);
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
      const voValue = parsed.vo;
      const durationValue = parsed.duration;
      const aiDataQualityValue = parsed.aiDataQuality;
      const aiDataQuality =
        aiDataQualityValue === "partial" || aiDataQualityValue === "minimal"
          ? aiDataQualityValue
          : null;
      return {
        beat: `Beat ${index + 1}`,
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
      beat: `Beat ${index + 1}`,
      duration: durations[index] ?? beat.duration ?? null,
    }));
  }

  function buildCombinedVoDraftFromBeats(beats: ScriptBeat[]): string {
    return beats
      .map((beat, index) => `Beat ${index + 1}:\n${normalizeMultilineText(String(beat.vo ?? ""))}`)
      .join("\n\n");
  }

  function normalizeMultilineText(value: string): string {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeSingleLineText(value: string): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function enforceBlankLineBetweenTextLines(value: string): string {
    const normalized = normalizeMultilineText(value);
    if (!normalized) return "";

    const lines = normalized.split("\n");
    const result: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (result.length > 0) {
        result.push("");
      }
      result.push(line);
    }
    return result.join("\n");
  }

  function splitCombinedVoDraftIntoSections(value: string): string[] {
    const normalized = normalizeMultilineText(value);
    if (!normalized) return [];
    const lines = normalized.split("\n");
    const sections: string[] = [];
    let current: string[] | null = null;
    let sawHeader = false;
    const headerPattern = /^Beat\s+\d+\s*:/i;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (headerPattern.test(line)) {
        sawHeader = true;
        if (current !== null) {
          sections.push(normalizeMultilineText(current.join("\n")));
        }
        current = [];
        continue;
      }
      if (current !== null) {
        current.push(rawLine);
      }
    }

    if (current !== null) {
      sections.push(normalizeMultilineText(current.join("\n")));
    }

    if (sawHeader) {
      return sections;
    }

    return normalized
      .split(/\n\s*\n+/)
      .map((section) => normalizeMultilineText(section))
      .filter(Boolean);
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
        throw new Error(data?.error || `Failed to load script (${res.status})`);
      }

      const script = data as ScriptDetails;
      const beats = extractScriptBeats(script.rawJson);
      setScriptPanelData(script);
      setScriptPanelDraftBeats(beats);
      setScriptPanelCombinedVoDraft(buildCombinedVoDraftFromBeats(beats));
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
    setScriptPanelCombinedVoDraft("");
    setScriptPanelSaving(false);
  }

  async function handleSaveScriptPanelEdits() {
    if (!scriptPanelOpenId) return;

    setScriptPanelSaving(true);
    setScriptPanelError(null);
    try {
      const sections = splitCombinedVoDraftIntoSections(scriptPanelCombinedVoDraft);
      if (sections.length !== scriptPanelDraftBeats.length) {
        throw new Error(
          `Expected ${scriptPanelDraftBeats.length} sections (one per beat), found ${sections.length}. Keep one 'Beat N:' header per section.`,
        );
      }

      const payloadScenes = scriptPanelDraftBeats.map((scene, index) => ({
        beat: `Beat ${index + 1}`,
        duration: scene.duration,
        vo: normalizeMultilineText(sections[index] ?? ""),
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
      const updatedBeats = extractScriptBeats(updatedScript.rawJson);
      setScriptPanelData(updatedScript);
      setScriptPanelDraftBeats(updatedBeats);
      setScriptPanelCombinedVoDraft(buildCombinedVoDraftFromBeats(updatedBeats));
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
    const nextPanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => {
          const normalized = normalizeStoryboardPanel(panel, index);
          const source = panel as Record<string, unknown>;
          const fallbackAction =
            typeof source?.characterAction === "string"
              ? source.characterAction
              : typeof source?.creatorAction === "string"
                ? source.creatorAction
                : typeof source?.["Character Action"] === "string"
                  ? source["Character Action"]
                  : null;
          return {
            ...normalized,
            characterAction:
              normalized.characterAction ??
              (typeof fallbackAction === "string" && fallbackAction.trim()
                ? fallbackAction.trim()
                : null),
          };
        })
      : [];
    setStoryboardDraftPanels(nextPanels);
    setStoryboardBeatEditorDrafts(buildStoryboardBeatEditorDraftsFromPanels(nextPanels));
    setStoryboardEditMode(true);
    setStoryboardSaveError(null);
    setStoryboardRegenerateError(null);
  }

  function cancelStoryboardEditMode() {
    const nextPanels = Array.isArray(storyboardPanelData?.panels)
      ? storyboardPanelData.panels.map((panel, index) => {
          const normalized = normalizeStoryboardPanel(panel, index);
          const source = panel as Record<string, unknown>;
          const fallbackAction =
            typeof source?.characterAction === "string"
              ? source.characterAction
              : typeof source?.creatorAction === "string"
                ? source.creatorAction
                : typeof source?.["Character Action"] === "string"
                  ? source["Character Action"]
                  : null;
          return {
            ...normalized,
            characterAction:
              normalized.characterAction ??
              (typeof fallbackAction === "string" && fallbackAction.trim()
                ? fallbackAction.trim()
                : null),
          };
        })
      : [];
    setStoryboardDraftPanels(nextPanels);
    setStoryboardBeatEditorDrafts(buildStoryboardBeatEditorDraftsFromPanels(nextPanels));
    setStoryboardEditMode(false);
    setStoryboardSaveError(null);
    setStoryboardRegenerateError(null);
    setStoryboardRegeneratingIndex(null);
  }

  function updateStoryboardDraftPanel(
    panelIndex: number,
    updater: (panel: StoryboardPanel) => StoryboardPanel,
  ) {
    setStoryboardDraftPanels((prev) => {
      const next = prev.map((panel, index) => (index === panelIndex ? updater(panel) : panel));
      return lockStoryboardDraftEnvironmentToSceneOne(next);
    });
  }

  function lockStoryboardDraftEnvironmentToSceneOne(panels: StoryboardPanel[]): StoryboardPanel[] {
    if (!panels.length) return panels;
    const canonical =
      String(panels[0]?.environment ?? "").trim() ||
      panels
        .map((panel) => String(panel.environment ?? "").trim())
        .find(Boolean) ||
      "Same environment as Scene 1, with consistent room layout, props, and lighting.";
    return panels.map((panel) => ({
      ...panel,
      environment: canonical,
    }));
  }

  function handleAddStoryboardPanel(afterIndex: number) {
    setStoryboardDraftPanels((prev) => {
      const insertionIndex = afterIndex + 1;
      const previousPanel = prev[afterIndex];
      const next = [...prev];
      next.splice(insertionIndex, 0, createEmptyStoryboardPanel(insertionIndex, previousPanel));
      return lockStoryboardDraftEnvironmentToSceneOne(next.map((panel, index) => ({
        ...panel,
        beatLabel: `Beat ${index + 1}`,
      })));
    });
  }

  function handleDeleteStoryboardPanel(panelIndex: number) {
    setStoryboardDraftPanels((prev) => {
      if (prev.length <= 1) return prev;
      return lockStoryboardDraftEnvironmentToSceneOne(prev
        .filter((_, index) => index !== panelIndex)
        .map((panel, index) => ({
          ...panel,
          beatLabel: `Beat ${index + 1}`,
        })));
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
      return lockStoryboardDraftEnvironmentToSceneOne(next);
    });
  }

  function mergeAdjacentPanels(
    panelA: StoryboardPanel,
    panelB: StoryboardPanel,
  ): StoryboardPanel {
    const parseTimeSeconds = (value: string | null | undefined): number => {
      const normalized = String(value ?? "").trim().toLowerCase();
      const match = normalized.match(/^(-?\d+(?:\.\d+)?)s?$/);
      if (!match) return 0;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const formatTimeSeconds = (value: number): string =>
      `${formatSecondsForBeatDuration(Math.max(0, value))}s`;

    const voA = panelA.vo?.trim() ?? "";
    const voB = panelB.vo?.trim() ?? "";
    const combinedVo = [voA, voB].filter(Boolean).join(" ");

    const bRollA = Array.isArray(panelA.bRollSuggestions) ? panelA.bRollSuggestions : [];
    const bRollB = Array.isArray(panelB.bRollSuggestions) ? panelB.bRollSuggestions : [];

    const actionA = panelA.characterAction?.trim() ?? "";
    const actionB = panelB.characterAction?.trim() ?? "";
    const combinedAction =
      actionA && actionB && actionA !== actionB
        ? `${actionA}, then ${actionB}`
        : actionA || actionB || null;

    const placementA = panelA.productPlacement?.trim() ?? "none";
    const placementB = panelB.productPlacement?.trim() ?? "none";
    const combinedPlacement =
      placementA !== "none" && placementB !== "none" && placementA !== placementB
        ? `${placementA}; ${placementB}`
        : placementA !== "none"
          ? placementA
          : placementB;
    const mergedStartSeconds = parseTimeSeconds(panelA.startTime);
    const mergedEndTime = formatTimeSeconds(mergedStartSeconds + 15);

    return {
      ...panelA,
      vo: combinedVo,
      endTime: mergedEndTime,
      bRollSuggestions: [...bRollA, ...bRollB],
      characterAction: combinedAction,
      productPlacement: combinedPlacement,
      beatLabel: `${panelA.beatLabel} + ${panelB.beatLabel}`,
    };
  }

  function mergeStoryboardPanels(panelIndex: number) {
    if (panelIndex >= storyboardDraftPanels.length - 1) return;

    const panelA = storyboardDraftPanels[panelIndex];
    const panelB = storyboardDraftPanels[panelIndex + 1];

    if (panelA.panelType !== panelB.panelType) {
      toast.error("Cannot merge panels of different types.");
      return;
    }

    const merged = mergeAdjacentPanels(panelA, panelB);
    const newPanels = [
      ...storyboardDraftPanels.slice(0, panelIndex),
      merged,
      ...storyboardDraftPanels.slice(panelIndex + 2),
    ];

    setStoryboardDraftPanels(lockStoryboardDraftEnvironmentToSceneOne(newPanels));
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
      const payloadPanels = storyboardDraftPanels.map((panel, index) => {
        const normalized = normalizeStoryboardPanel(panel, index);
        return {
          ...normalized,
          beatLabel: `Beat ${index + 1}`,
          startTime: normalizeSingleLineText(normalized.startTime ?? ""),
          endTime: normalizeSingleLineText(normalized.endTime ?? ""),
          vo: enforceBlankLineBetweenTextLines(normalized.vo ?? ""),
          characterAction: normalized.characterAction
            ? enforceBlankLineBetweenTextLines(normalized.characterAction)
            : null,
          environment: normalized.environment
            ? enforceBlankLineBetweenTextLines(normalized.environment)
            : null,
          cameraDirection: enforceBlankLineBetweenTextLines(normalized.cameraDirection ?? ""),
          productPlacement: enforceBlankLineBetweenTextLines(normalized.productPlacement ?? ""),
          voiceoverOnly: Boolean(normalized.voiceoverOnly),
          bRollSuggestions: (normalized.bRollSuggestions ?? [])
            .map((entry) => enforceBlankLineBetweenTextLines(entry))
            .filter(Boolean),
        };
      });
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
      setStoryboardPanelData({
        ...storyboard,
        panels: normalizedPanels,
      });
      setStoryboardDraftPanels(normalizedPanels);
      setStoryboardBeatEditorDrafts(buildStoryboardBeatEditorDraftsFromPanels(normalizedPanels));
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
      const useSelectedRunOnly = Boolean(selectedRunId);
      const effectiveJobs = useSelectedRunOnly ? activeRunJobs : allJobs;
      diagnostics.set(jobType, {
        activeRunJobs,
        allJobs,
        effectiveJobs,
        source: useSelectedRunOnly || activeRunJobs.length > 0 ? "selected_run" : "all_runs",
        status: deriveStepStatus(effectiveJobs),
      });
    }
    return diagnostics;
  }, [jobs, jobsInActiveRun, selectedRunId]);

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
  const latestStoryboardJob = getJobsForType(JobType.STORYBOARD_GENERATION)[0];
  const latestStoryboardJobSignature = latestStoryboardJob
    ? `${latestStoryboardJob.id}:${latestStoryboardJob.status}:${latestStoryboardJob.updatedAt}`
    : "";
  const latestVideoImageJob = getJobsForType(JobType.VIDEO_IMAGE_GENERATION)[0];
  const latestVideoImageJobSignature = latestVideoImageJob
    ? `${latestVideoImageJob.id}:${latestVideoImageJob.status}:${latestVideoImageJob.updatedAt}`
    : "";
  const latestVideoPromptJob = getJobsForType(JobType.VIDEO_PROMPT_GENERATION)[0];
  const latestVideoPromptJobSignature = latestVideoPromptJob
    ? `${latestVideoPromptJob.id}:${latestVideoPromptJob.status}:${latestVideoPromptJob.updatedAt}`
    : "";

  const storyboardPanelsForSceneFlow = useMemo(() => {
    if (!latestCompletedStoryboardId) return [] as StoryboardPanel[];
    if (!storyboardPanelData) return [] as StoryboardPanel[];
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

  const videoImagesDerivedStatus: ProductionStep["status"] = (() => {
    const jobStatus = getStepStatus(JobType.VIDEO_IMAGE_GENERATION);
    const sceneFlowPanels = Array.from(sceneFlowPanelByNumber.values());
    const allSceneFramesGenerated =
      sceneFlowPanels.length > 0 &&
      sceneFlowPanels.every((panel) => Boolean(getSceneLastFrameImageUrl(panel)));
    if (allSceneFramesGenerated) return "completed";
    if (jobStatus === "completed") return "completed";
    if (sceneGeneratingNumber !== null || submitting === "video_images" || jobStatus === "running") {
      return "running";
    }
    if (jobStatus === "failed") return "failed";
    return "not_started";
  })();
  const storyboardCompleted = getStepStatus(JobType.STORYBOARD_GENERATION) === "completed";

  // Build production pipeline with dependencies
  const steps: ProductionStep[] = [
    {
      key: "script",
      label: "Generate Script",
      description: "Write the ad script using your selected strategy and available research.",
      jobType: JobType.SCRIPT_GENERATION,
      status: getStepStatus(JobType.SCRIPT_GENERATION),
      canRun: true, // Can always run, but quality depends on research
      locked: false,
      lastJob: getJobsForType(JobType.SCRIPT_GENERATION)[0],
    },
    {
      key: "storyboard",
      label: "Create Storyboard",
      description: "Turn the script into scene-by-scene shots with voiceover and visual direction.",
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
      description: "Create first-frame and last-frame prompts for each storyboard scene.",
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
      label: "Generate First Frames",
      description: "Create the first frame images used to guide each generated video scene.",
      jobType: JobType.VIDEO_IMAGE_GENERATION,
      status: videoImagesDerivedStatus,
      canRun:
        storyboardCompleted &&
        hasSelectedProductReferenceImage &&
        (runCharacters.length === 0 || Boolean(selectedStoryboardCharacterId)),
      locked:
        !storyboardCompleted ||
        !hasSelectedProductReferenceImage ||
        (runCharacters.length > 0 && !selectedStoryboardCharacterId),
      lockReason: !storyboardCompleted
        ? "Create storyboard first"
        : !hasSelectedProductReferenceImage
          ? "Upload product image in Product Setup first"
          : "Select a character from Character Casting first",
      lastJob: latestVideoImageJob,
    },
    {
      key: "video_prompts",
      label: "Generate Video Prompts",
      description: "Write motion prompts for each scene using the storyboard and first frames.",
      jobType: JobType.VIDEO_PROMPT_GENERATION,
      status: getStepStatus(JobType.VIDEO_PROMPT_GENERATION),
      canRun: getStepStatus(JobType.VIDEO_IMAGE_GENERATION) === "completed",
      locked: getStepStatus(JobType.VIDEO_IMAGE_GENERATION) !== "completed",
      lockReason: "Generate first frames first",
      lastJob: getJobsForType(JobType.VIDEO_PROMPT_GENERATION)[0],
    },
    {
      key: "video",
      label: "Generate Video",
      description: "Render the final video scenes from your prompts and scene inputs.",
      jobType: JobType.VIDEO_GENERATION,
      status: getStepStatus(JobType.VIDEO_GENERATION),
      canRun: hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_PROMPT_GENERATION),
      lockReason: "Generate prompts first",
      lastJob: getJobsForType(JobType.VIDEO_GENERATION)[0],
    },
    {
      key: "review",
      label: "Edit Video",
      description: "Trim, keep, and merge your generated scenes into one finished video.",
      jobType: JobType.VIDEO_REVIEW,
      status: getStepStatus(JobType.VIDEO_REVIEW),
      canRun: hasCompletedJob(JobType.VIDEO_GENERATION),
      locked: !hasCompletedJob(JobType.VIDEO_GENERATION),
      lockReason: "Generate video first",
      lastJob: getJobsForType(JobType.VIDEO_REVIEW)[0],
    },
  ];
  // ARCHIVED: Image generation replaced by Sora 2 Character Cameos.
  const visibleSteps = steps.filter((step) => step.key !== "image_prompts");

  async function runStep(
    step: ProductionStep,
    extraPayload?: Record<string, unknown>
  ): Promise<boolean> {
    if (!step.canRun || step.locked) return false;
    if (!selectedProductId) {
      setError("Select or create a product first.");
      return false;
    }
    if (step.key === "video_images" && !hasSelectedProductReferenceImage) {
      setError(
        "Upload product image in Product Setup before generating first frames.",
      );
      return false;
    }

    setSubmitting(step.key);
    setError(null);

    try {
      const activeRunId = String(selectedRunId ?? "").trim();
      const explicitRunIdFromPayload = String(extraPayload?.runId ?? "").trim();
      const resolvedRunId = explicitRunIdFromPayload || activeRunId;
      const activeStoryboardCharacterId = String(selectedStoryboardCharacterId ?? "").trim();
      let endpoint = "";
      let payload: any = {
        ...(extraPayload || {}),
        // If payload includes runId, respect it. Otherwise fall back to selected active run.
        ...(resolvedRunId ? { runId: resolvedRunId } : {}),
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
      };

      endpoint = endpointMap[step.key];

      if (!endpoint) {
        throw new Error("Endpoint not configured for this step");
      }

      if (step.key === "storyboard") {
        if (activeRunId && runCharacters.length > 0 && !activeStoryboardCharacterId) {
          throw new Error("Select a character from Character Casting before creating storyboard.");
        }
        if (activeStoryboardCharacterId) {
          payload = {
            ...payload,
            characterId: activeStoryboardCharacterId,
          };
        }
        payload = {
          ...payload,
          attemptKey: `storyboard-${Date.now()}`,
        };
      }

      if (
        step.key === "video_prompts" ||
        step.key === "video_images" ||
        step.key === "image_prompts"
      ) {
        const storyboardId = String(latestCompletedStoryboardId ?? "").trim();
        if (!storyboardId) {
          throw new Error(
            "No completed storyboard found for the selected run. Run Create Storyboard first.",
          );
        }
        payload = {
          ...payload,
          storyboardId,
          ...(activeStoryboardCharacterId ? { characterId: activeStoryboardCharacterId } : {}),
        };
      }

      if (step.key === "video") {
        const storyboardId = String(latestCompletedStoryboardId ?? "").trim();
        if (!storyboardId) {
          throw new Error(
            "No completed storyboard found for the selected run. Run Create Storyboard first.",
          );
        }
        const sortByNewest = (a: Job, b: Job) =>
          new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
        const latestScriptJob =
          jobsInActiveRun
            .filter((job) => job.type === JobType.SCRIPT_GENERATION && job.status === JobStatus.COMPLETED)
            .sort(sortByNewest)[0] ??
          jobs
            .filter((job) => job.type === JobType.SCRIPT_GENERATION && job.status === JobStatus.COMPLETED)
            .sort(sortByNewest)[0] ??
          null;
        const scriptId = getScriptIdFromJob(latestScriptJob);
        if (!scriptId) {
          throw new Error(
            "No completed script found for the selected run. Run Generate Script first.",
          );
        }

        payload = {
          ...payload,
          storyboardId,
          scriptId,
          forceNew: true,
        };
      }

      console.log("[Creative] runStep request payload", {
        step: step.key,
        endpoint,
        selectedRunId,
        activeRunId: activeRunId || null,
        explicitRunIdFromPayload: explicitRunIdFromPayload || null,
        resolvedRunId: resolvedRunId || null,
        activeStoryboardCharacterId: activeStoryboardCharacterId || null,
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
      if (data?.ok === false) {
        const apiError =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : "Script generation failed to produce output.";
        throw new Error(apiError);
      }
      console.log("[Creative] Job created:", data.jobId);
      const finalizedRunId =
        typeof data?.runId === "string" && data.runId.trim().length > 0
          ? String(data.runId)
          : resolvedRunId || null;
      if (finalizedRunId) {
        setSelectedRunId(finalizedRunId);
      }
      if (typeof data?.jobId === "string" && data.jobId.trim().length > 0) {
        const nowIso = new Date().toISOString();
        const optimisticJob: Job = {
          id: String(data.jobId),
          type: step.jobType,
          status: JobStatus.PENDING,
          createdAt: nowIso,
          updatedAt: nowIso,
          runId: finalizedRunId,
          payload: {
            ...(payload || {}),
            ...(finalizedRunId ? { runId: finalizedRunId } : {}),
          } as Record<string, unknown>,
        };
        setJobs((prev) => {
          if (prev.some((job) => job.id === optimisticJob.id)) {
            return prev;
          }
          return [optimisticJob, ...prev];
        });
      }
      void loadProjectRuns();

      // Reload jobs
      await loadJobs(selectedProductId);
      toast.success("Job queued successfully.");
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
    setScriptGenerationStrategy("swipe_template");
    setSelectedSwipeTemplateAdId("");
    setManualSwipeTemplateTitle("");
    setManualSwipeTemplateTranscript("");
    setManualSwipeTemplateUploading(false);
    setSwipeAnalysis(null);
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

  function isStepCollapsed(stepKey: string, status: ProductionStep["status"]): boolean {
    if (stepKey in collapsedSteps) return collapsedSteps[stepKey];
    return status === "completed" || status === "not_started";
  }

  function toggleStepCollapsed(stepKey: string, status: ProductionStep["status"]) {
    setCollapsedSteps((prev) => ({
      ...prev,
      [stepKey]: !isStepCollapsed(stepKey, status),
    }));
  }

  function getOutputToggleLabel(step: ProductionStep, isExpanded: boolean): string {
    const labelMap: Record<string, string> = {
      storyboard: "Storyboard",
      image_prompts: "Image Prompts",
      video_prompts: "Video Prompts",
    };
    const noun = labelMap[step.key] ?? step.label.replace(/^Generate\s+/i, "").replace(/^Create\s+/i, "");
    return `${isExpanded ? "Close" : "View"} ${noun}`;
  }

  async function refreshStoryboardForOutput(storyboardId: string) {
    const targetId = String(storyboardId || "").trim();
    if (!targetId) return;
    const myRequestId = ++storyboardFetchRef.current;
    setStoryboardPanelId(targetId);
    setStoryboardPanelLoading(true);
    setStoryboardPanelError(null);
    try {
      const res = await fetch(`/api/storyboards/${targetId}`, {
        cache: "no-store",
      });
      if (myRequestId !== storyboardFetchRef.current) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.storyboard) {
        throw new Error(data?.error || "Failed to load storyboard panels");
      }
      const storyboard = data.storyboard as StoryboardDetails;
      const normalizedPanels = Array.isArray(storyboard.panels)
        ? storyboard.panels.map((panel, index) => normalizeStoryboardPanel(panel, index))
        : [];
      setStoryboardPanelData({
        ...storyboard,
        panels: normalizedPanels,
      });
      if (normalizedPanels.length === 0) {
        setStoryboardPanelError("Storyboard generation failed to produce output.");
      } else {
        setStoryboardPanelError(null);
      }
    } catch (err: any) {
      if (myRequestId !== storyboardFetchRef.current) return;
      setStoryboardPanelData(null);
      setStoryboardPanelError(err?.message || "Failed to load storyboard panels");
    } finally {
      if (myRequestId !== storyboardFetchRef.current) return;
      setStoryboardPanelLoading(false);
    }
  }

  useEffect(() => {
    const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
    if (!activeStoryboardId) return;
    if (
      !latestStoryboardJobSignature &&
      !latestVideoImageJobSignature &&
      !latestVideoPromptJobSignature
    ) {
      return;
    }
    void refreshStoryboardForOutput(activeStoryboardId);
  }, [
    latestCompletedStoryboardId,
    latestStoryboardJobSignature,
    latestVideoImageJobSignature,
    latestVideoPromptJobSignature,
    storyboardPanelId,
  ]);

  function handleStepRunClick(step: ProductionStep) {
    if (step.key === "script") {
      resetScriptModal();
      setShowScriptModal(true);
      return;
    }
    if (step.key === "storyboard") {
      setStoryboardModalError(null);
      setStoryboardModalMode("choose");
      setShowStoryboardModal(true);
      return;
    }
    if (isViewableCompletedStep(step) && !isCompletedStepOutputExpanded(step.key)) {
      if (step.key === "image_prompts" || step.key === "video_prompts") {
        const targetStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
        if (targetStoryboardId) {
          void refreshStoryboardForOutput(targetStoryboardId);
        }
      }
      toggleCompletedStepOutput(step.key);
      return;
    }
    if (step.key === "video" && step.canRun && !step.locked && !hasSelectedProductReferenceImage) {
      setPendingVideoStep(step);
      setShowMissingProductImageWarning(true);
      return;
    }
    void runStep(step);
  }

  function parseBeatDurationRange(durationValue: string | number | null): { startTime: string; endTime: string } {
    const raw = String(durationValue ?? "").trim();
    const match = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s?/i);
    if (!match) {
      return { startTime: "", endTime: "" };
    }
    return {
      startTime: `${match[1]}s`,
      endTime: `${match[2]}s`,
    };
  }

  async function openManualStoryboardBuilder() {
    const sortByNewest = (a: Job, b: Job) =>
      new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
    const latestScriptJob =
      jobsInActiveRun
        .filter((job) => job.type === JobType.SCRIPT_GENERATION && job.status === JobStatus.COMPLETED)
        .sort(sortByNewest)[0] ??
      jobs
        .filter((job) => job.type === JobType.SCRIPT_GENERATION && job.status === JobStatus.COMPLETED)
        .sort(sortByNewest)[0] ??
      null;
    const scriptId = getScriptIdFromJob(latestScriptJob);
    if (!scriptId) {
      setStoryboardModalError("No completed script found. Generate script first.");
      return;
    }

    try {
      setStoryboardModalSubmitting(true);
      setStoryboardModalError(null);
      const res = await fetch(`/api/projects/${projectId}/scripts/${scriptId}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load script for manual storyboard.");
      }
      const script = data as ScriptDetails;
      const beats = extractScriptBeats(script.rawJson);
      if (!beats.length) {
        throw new Error("Selected script has no beats.");
      }
      const drafts: ManualStoryboardPanelDraft[] = beats.map((beat, index) => {
        const timing = parseBeatDurationRange(beat.duration);
        return {
          beatLabel: `Beat ${index + 1}`,
          startTime: timing.startTime,
          endTime: timing.endTime,
          vo: String(beat.vo ?? "").trim(),
          creatorAction: "",
          textOverlay: "",
          visualDescription: "",
          productPlacement: "",
        };
      });
      setManualStoryboardPanels(drafts);
      setStoryboardModalMode("manual");
    } catch (err: any) {
      setStoryboardModalError(err?.message || "Failed to prepare manual storyboard.");
    } finally {
      setStoryboardModalSubmitting(false);
    }
  }

  function updateManualStoryboardPanel(
    index: number,
    key: "creatorAction" | "textOverlay" | "visualDescription" | "productPlacement",
    value: string,
  ) {
    setManualStoryboardPanels((prev) =>
      prev.map((panel, panelIndex) =>
        panelIndex === index ? { ...panel, [key]: value } : panel,
      ),
    );
  }

  async function handleGenerateStoryboardWithMode(
    mode: "ai" | "manual",
    manualPanels?: ManualStoryboardPanelDraft[],
  ) {
    const storyboardStep = steps.find((step) => step.key === "storyboard");
    if (!storyboardStep) return;

    setStoryboardModalSubmitting(true);
    setStoryboardModalError(null);
    setShowStoryboardModal(false);
    const ok = await runStep(storyboardStep, {
      storyboardMode: mode,
      ...(mode === "manual" && Array.isArray(manualPanels)
        ? {
            manualPanels: manualPanels.map((panel, index) => ({
              beatLabel: `Beat ${index + 1}`,
              startTime: normalizeSingleLineText(panel.startTime),
              endTime: normalizeSingleLineText(panel.endTime),
              vo: enforceBlankLineBetweenTextLines(panel.vo),
              creatorAction: enforceBlankLineBetweenTextLines(panel.creatorAction),
              textOverlay: normalizeSingleLineText(panel.textOverlay),
              visualDescription: enforceBlankLineBetweenTextLines(panel.visualDescription),
              productPlacement: enforceBlankLineBetweenTextLines(panel.productPlacement),
            })),
          }
        : {}),
    });
    setStoryboardModalSubmitting(false);
    if (!ok) {
      setShowStoryboardModal(true);
      setStoryboardModalError("Failed to start storyboard generation.");
    } else {
      setStoryboardModalMode("choose");
      setManualStoryboardPanels([]);
    }
  }

  function toggleSceneReview(sceneNumber: number) {
    setSceneReviewOpenByNumber((prev) => ({
      ...prev,
      [sceneNumber]: !prev[sceneNumber],
    }));
  }

  function toggleSceneVideoReview(sceneNumber: number) {
    setSceneVideoReviewOpenByNumber((prev) => ({
      ...prev,
      [sceneNumber]: !prev[sceneNumber],
    }));
  }

  async function handleGenerateScene(sceneNumber: number, additionalInstructions?: string) {
    const videoImagesStep = steps.find((step) => step.key === "video_images");
    if (!videoImagesStep) return;
    setSceneActionError(null);

    // Warn only when Scene 1 has previously been generated in this run
    // and there are downstream scenes generated from an older anchor.
    if (sceneNumber === 1) {
      const scene1LastGeneratedAt = latestFirstFrameGenerationBySceneInActiveRun.get(1) ?? 0;
      const downstreamScenesImpacted = Array.from(latestFirstFrameGenerationBySceneInActiveRun.entries())
        .filter(([n, ts]) => n > 1 && Number.isFinite(ts) && ts > 0)
        .filter(([, ts]) => ts <= scene1LastGeneratedAt || scene1LastGeneratedAt > 0)
        .map(([n]) => n)
        .sort((a, b) => a - b);
      if (scene1LastGeneratedAt > 0 && downstreamScenesImpacted.length > 0) {
        const confirmed = window.confirm(
          `Regenerating Scene 1 will change the identity anchor for this run.\n\nScenes ${downstreamScenesImpacted.join(", ")} have existing first-frame generations in this run and should be regenerated afterwards to maintain consistency.`,
        );
        if (!confirmed) return;
      }
    }

    setSceneGeneratingNumber(sceneNumber);
    setSceneReviewOpenByNumber((prev) => ({
      ...prev,
      [sceneNumber]: false,
    }));
    setStoryboardPanelData((prev) => {
      if (!prev || !Array.isArray(prev.panels)) return prev;
      const nextPanels = prev.panels.map((panel) => {
        const panelSceneNumber = Number(panel.sceneNumber);
        if (!Number.isInteger(panelSceneNumber) || panelSceneNumber !== sceneNumber) {
          return panel;
        }
        return {
          ...panel,
          approved: false,
          firstFrameImageUrl: null,
          lastFrameImageUrl: null,
        };
      });
      return {
        ...prev,
        panels: nextPanels,
      };
    });
    const resolvedAdditionalInstructions =
      String(additionalInstructions ?? sceneAdditionalInstructionsByNumber[sceneNumber] ?? "").trim();
    const ok = await runStep(videoImagesStep, {
      sceneNumber,
      ...(resolvedAdditionalInstructions
        ? { additionalInstructions: resolvedAdditionalInstructions }
        : {}),
      runNonce: `scene-${sceneNumber}-${Date.now()}`,
    });
    if (ok) {
      const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
      if (activeStoryboardId) {
        void refreshStoryboardForOutput(activeStoryboardId);
      }
    }
    setSceneGeneratingNumber(null);
  }

  async function handleGenerateSceneVideo(sceneNumber: number) {
    const videoStep = steps.find((step) => step.key === "video");
    if (!videoStep) return;
    if (videoStep.locked || !videoStep.canRun) {
      setSceneActionError(videoStep.lockReason || "Video generation is currently locked.");
      return;
    }
    if (videoGeneratingNumber !== null) return;

    setSceneActionError(null);
    setVideoGeneratingNumber(sceneNumber);
    setSceneVideoReviewOpenByNumber((prev) => ({
      ...prev,
      [sceneNumber]: false,
    }));

    const ok = await runStep(videoStep, {
      sceneNumber,
      forceNew: true,
      runNonce: `scene-video-${sceneNumber}-${Date.now()}`,
    });
    if (ok) {
      const activeStoryboardId = String(storyboardPanelId || latestCompletedStoryboardId || "").trim();
      if (activeStoryboardId) {
        void refreshStoryboardForOutput(activeStoryboardId);
      }
    }
    setVideoGeneratingNumber(null);
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

  async function handleChooseGenerateWithAi(
    preferredStrategy: "swipe_template" | "research_formula" | "upload_template" = "swipe_template"
  ) {
    setScriptGenerationStrategy(preferredStrategy);
    setScriptModalMode("ai");
    setScriptModalError(null);
    setScriptRunsLoading(true);

    try {
      const runs = await loadScriptResearchRuns();
      setScriptResearchRuns(runs);
      const activeRunId = String(selectedRunId ?? "").trim();
      const matchingRunJobId = activeRunId
        ? (runs.find((run) => String(run.runId ?? "").trim() === activeRunId)?.jobId ?? "")
        : "";
      // Important: when there's no active run, do not auto-bind script generation to any historical run.
      setSelectedScriptResearchJobId(matchingRunJobId);
      setSelectedSwipeTemplateAdId("");
      setScriptNoResearchAcknowledged(false);
    } catch (err: any) {
      setScriptResearchRuns([]);
      setSelectedScriptResearchJobId("");
      setSelectedSwipeTemplateAdId("");
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

  useEffect(() => {
    if (scriptModalMode !== "ai") return;
    const candidates =
      scriptGenerationStrategy === "upload_template"
        ? scriptSwipeFileCandidates
        : scriptRunSummary?.swipeRecommendation?.candidates ?? [];
    if (candidates.length === 0) {
      setSelectedSwipeTemplateAdId("");
      return;
    }
    const recommended = scriptRunSummary?.swipeRecommendation?.recommendedAdId ?? "";
    setSelectedSwipeTemplateAdId((prev) => {
      if (prev && candidates.some((candidate) => candidate.assetId === prev)) return prev;
      if (
        scriptGenerationStrategy === "swipe_template" &&
        recommended &&
        candidates.some((candidate) => candidate.assetId === recommended)
      ) {
        return recommended;
      }
      return candidates[0]?.assetId ?? "";
    });
  }, [scriptModalMode, scriptRunSummary, scriptGenerationStrategy, scriptSwipeFileCandidates]);

  useEffect(() => {
    if (
      scriptModalMode !== "ai" ||
      (scriptGenerationStrategy !== "swipe_template" && scriptGenerationStrategy !== "upload_template")
    ) {
      setSwipeAnalysis(null);
      return;
    }

    if (!selectedSwipeTemplateAdId) {
      setSwipeAnalysis(null);
      return;
    }

    const candidate = scriptSwipeCandidates.find((c) => c.assetId === selectedSwipeTemplateAdId);
    const transcript = candidate?.transcriptSnippet;
    if (!transcript) {
      setSwipeAnalysis(null);
      return;
    }

    const analysis = analyzeSwipeTranscript(transcript);
    setSwipeAnalysis(analysis);
  }, [
    scriptModalMode,
    scriptGenerationStrategy,
    selectedSwipeTemplateAdId,
    scriptSwipeCandidates,
  ]);

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
    if (scriptGenerationStrategy === "swipe_template" || scriptGenerationStrategy === "upload_template") {
      const hasCandidates =
        scriptGenerationStrategy === "upload_template"
          ? scriptSwipeFileCandidates.length > 0
          : (scriptRunSummary?.swipeRecommendation?.candidates?.length ?? 0) > 0;
      if (hasCandidates && !selectedSwipeTemplateAdId) {
        setScriptModalError(
          scriptGenerationStrategy === "upload_template"
            ? "Upload/select a transcript template before generating."
            : "Select a swipe template ad before generating.",
        );
        return;
      }
    }

    setScriptModalSubmitting(true);
    setScriptModalError(null);
    const normalizedScriptStrategy =
      scriptGenerationStrategy === "upload_template" ? "swipe_template" : scriptGenerationStrategy;
    const scriptGenerationPayload: Record<string, unknown> = {
      forceNew: true,
      scriptStrategy: normalizedScriptStrategy,
      ...(selectedScriptResearchRun?.runId
        ? { runId: String(selectedScriptResearchRun.runId).trim() }
        : {}),
      ...(swipeAnalysis?.beatRatios
        ? { beatRatios: swipeAnalysis.beatRatios }
        : {}),
      ...((scriptGenerationStrategy === "swipe_template" || scriptGenerationStrategy === "upload_template") &&
      selectedSwipeTemplateAdId
        ? { swipeTemplateAdId: selectedSwipeTemplateAdId }
        : {}),
      ...(selectedScriptResearchJobId
        ? { customerAnalysisJobId: selectedScriptResearchJobId }
        : {}),
    };
    setShowScriptModal(false);
    const ok = await runStep(scriptStep, scriptGenerationPayload);
    console.log("[ScriptModal] runStep returned:", ok);
    setScriptModalSubmitting(false);

    if (ok) {
      resetScriptModal();
    }
  }

  async function handleUploadManualSwipeTemplateTranscript() {
    const activeRunId = String(selectedScriptResearchRun?.runId ?? "").trim();
    if (!activeRunId) {
      setScriptModalError("Select a completed research run before uploading a template transcript.");
      return;
    }

    const transcript = String(manualSwipeTemplateTranscript ?? "").trim();
    if (!transcript || transcript.length < 100) {
      setScriptModalError("Transcript must be at least 100 characters.");
      return;
    }

    setManualSwipeTemplateUploading(true);
    setScriptModalError(null);
    try {
      const res = await fetch("/api/jobs/script-template-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          runId: activeRunId,
          title: String(manualSwipeTemplateTitle ?? "").trim() || "Manual swipe template",
          transcript,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Server returned ${res.status}`);
      }

      const refreshed = await loadScriptRunSummary(activeRunId);
      setScriptRunSummary(refreshed);
      if (typeof data?.adAssetId === "string" && data.adAssetId.trim().length > 0) {
        setSelectedSwipeTemplateAdId(data.adAssetId);
      }
      setManualSwipeTemplateTitle("");
      setManualSwipeTemplateTranscript("");
      toast.success("Transcript template uploaded.");
    } catch (err: any) {
      setScriptModalError(err?.message || "Failed to upload transcript template");
    } finally {
      setManualSwipeTemplateUploading(false);
    }
  }

  async function handleUploadScript() {
    const text = String(scriptUploadText ?? "").trim();
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
      <div className="w-4 h-4 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
    );
  }

  function getStepBadge(status: ProductionStep["status"]) {
    const labels = {
      not_started: "Initialized",
      running: "Processing",
      completed: "Verified",
      failed: "Error",
    };
    const colors = {
      not_started: "subtle opacity-40",
      running: "bg-accent/10 text-accent border-accent/20 animate-pulse",
      completed: "bg-accent-2/10 text-accent-2 border-accent-2/20",
      failed: "bg-danger/10 text-danger border-danger/20",
    };
    
    return (
      <div className={`status-chip !px-3 !py-1 text-[8px] font-bold uppercase tracking-[0.2em] ${colors[status]}`}>
        {labels[status]}
      </div>
    );
  }


  if (loading) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-muted/80">Loading creative studio...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white pb-20">
      <div className="px-8 py-10 max-w-[1400px] mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="space-y-4">
            <Link
              href={`/projects/${projectId}`}
              className="text-[11px] font-mono text-muted hover:text-white mb-6 inline-block uppercase tracking-wider transition-colors"
            >
              ← Back to Project
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-bold text-white tracking-tight">Creative Studio</h1>
              <div className="status-chip subtle uppercase tracking-widest text-[9px]">
                Studio Active
              </div>
            </div>
            <p className="text-xs text-muted font-mono uppercase tracking-widest opacity-60">
              Workflow: <span className="text-accent-2">Ad Creation</span>
              <span className="mx-3 opacity-20">|</span>
              Project: <span className="text-white">{projectId.substring(0, 8)}</span>
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-card border border-danger/20 bg-danger/5 p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
            <p className="text-[11px] font-mono text-danger uppercase tracking-widest">{error}</p>
            <button onClick={() => setError(null)} className="text-white/20 hover:text-white transition-colors">✕</button>
          </div>
        )}

        <div className="rounded-card border border-line bg-panel p-8 shadow-panel backdrop-blur-panel mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-6">
              <div>
                <p className="card-label mb-4">Product Focus</p>
                {products.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] ml-1">Active Product</label>
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
                        className="w-full bg-bg-elevated border border-line rounded-card px-4 py-3 text-sm text-white font-mono outline-none focus:border-accent/40 transition-colors cursor-pointer"
                      >
                        {products.map((product) => (
                          <option key={product.id} value={product.id} className="bg-bg text-white">
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-danger/80 font-mono uppercase tracking-widest py-4 border border-danger/20 bg-danger/5 rounded-card text-center">
                    No Products Added
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <p className="card-label mb-4">Campaign Run</p>
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] ml-1">Active Run</label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <select
                        value={selectedRunId || "no-active"}
                        onChange={(e) => {
                          const value = e.target.value === "no-active" ? null : e.target.value;
                          setSelectedRunId(value);
                        }}
                        className="flex-1 bg-bg-elevated border border-line rounded-card px-4 py-3 text-sm text-white font-mono outline-none focus:border-accent/40 transition-colors cursor-pointer"
                      >
                      <option value="no-active" className="bg-bg text-white">No Active Run</option>
                        {sortedRuns.map((run) => (
                          <option key={run.runId} value={run.runId} className="bg-bg text-white">
                            {run.displayLabel}
                          </option>
                        ))}
                      </select>
                      {selectedRunId ? (
                        <Link
                          href={`/projects/${projectId}/creative-studio/run-data/${selectedRunId}`}
                          className="btn btn-secondary !min-h-[46px] px-6 text-[10px]"
                        >
                          View Run Data
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="btn btn-secondary !min-h-[46px] px-6 text-[10px] opacity-50 cursor-not-allowed"
                        >
                          View Run Data
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowRunManagerModal(true)}
                        className="btn btn-secondary !min-h-[46px] px-6 text-[10px]"
                      >
                        Run Manager
                      </button>
                      <RunManagementModal
                        projectId={projectId}
                        open={showRunManagerModal}
                        onClose={() => setShowRunManagerModal(false)}
                        onRunsChanged={handleRunsChanged}
                      />
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>

        {orphanedJobsCount > 0 && (
          <div className="rounded-card border border-danger/20 bg-danger/5 p-5 flex items-center justify-between gap-6 animate-in slide-in-from-right-4 duration-700">
              <p className="text-[10px] font-mono text-danger/80 uppercase tracking-widest leading-relaxed">
                Found {orphanedJobsCount} jobs not attached to a run.
              </p>
            <button
              onClick={() => void handleCleanupOrphanedJobs()}
              disabled={cleaningOrphanedJobs}
              className="btn btn-danger !min-h-[36px] px-6 text-[9px] uppercase font-bold tracking-widest whitespace-nowrap"
            >
              {cleaningOrphanedJobs ? "Cleaning..." : "Clean Up Jobs"}
            </button>
          </div>
        )}

        {selectedProduct && !selectedStoryboardCharacterId && (
          <div className="rounded-card border border-accent/20 bg-accent/5 p-5 flex items-center justify-between gap-6 animate-in slide-in-from-right-4 duration-700">
            <div className="flex items-center gap-4">
              <span className="text-xl">⚠️</span>
              <p className="text-[11px] font-mono text-accent uppercase tracking-widest leading-relaxed">
                <span className="font-black">Character recommended:</span> add a character for more consistent ads.
              </p>
            </div>
            <Link
              href={`/products/${selectedProduct.id}`}
              className="btn btn-secondary !min-h-[36px] px-6 text-[9px] uppercase font-bold tracking-widest whitespace-nowrap"
            >
              Set Up Character
            </Link>
          </div>
        )}

        {/* Character Casting Section */}
        <div className="rounded-card border border-line bg-panel p-6 space-y-6">
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono text-accent uppercase tracking-widest font-bold">Character</span>
          </div>

          <div className="space-y-4">
            {!selectedRunId ? (
              <p className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40 italic">Select a run to load matching characters.</p>
            ) : runCharacters.length === 0 ? (
              <div className="p-4 rounded-card border border-accent/20 bg-accent/5">
                <p className="text-[10px] font-mono text-accent uppercase tracking-widest">No characters found for this run.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] ml-1">
                    Active Character
                  </label>
                  <select
                    value={selectedStoryboardCharacterId ?? ""}
                    onChange={(event) => setSelectedStoryboardCharacterId(event.target.value || null)}
                    className="w-full md:max-w-md h-12 bg-bg-elevated border border-line rounded-card px-4 text-[11px] font-mono text-white uppercase tracking-widest focus:border-accent/50 outline-none transition-all"
                  >
                    {runCharacters.map((char) => (
                      <option key={char.id} value={char.id} className="bg-bg">
                        {char.name.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-card border border-line bg-bg-elevated p-5 flex flex-col md:flex-row items-start gap-5 overflow-hidden">
                  <div className="w-28 h-28 rounded-card border border-line overflow-hidden bg-panel flex items-center justify-center flex-shrink-0">
                    {selectedRunCharacter?.seedVideoUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setCharacterPreview({
                            url: selectedRunCharacter.seedVideoUrl!,
                            name: selectedRunCharacter.name,
                          })
                        }
                        className="w-full h-full inline-flex rounded-card focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        <img
                          src={selectedRunCharacter.seedVideoUrl}
                          alt={selectedRunCharacter.name}
                          className="w-full h-full object-cover object-top cursor-zoom-in"
                        />
                      </button>
                    ) : (
                      <span className="text-[10px] font-mono text-muted uppercase tracking-widest opacity-50">
                        No Image
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    <p className="text-lg font-bold text-white tracking-tight">
                      {selectedRunCharacter?.name ?? "No Character Selected"}
                    </p>
                    {selectedRunCharacter?.creatorVisualPrompt && (
                      <div className="space-y-1">
                        {selectedRunCharacter.creatorVisualPrompt
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean)
                          .map((line, i) => {
                            const colonIndex = line.indexOf(":");
                            if (colonIndex === -1) {
                              return (
                                <p key={i} className="text-[11px] font-mono text-white/50 leading-relaxed">
                                  {line}
                                </p>
                              );
                            }
                            const label = line.slice(0, colonIndex).trim();
                            const value = line.slice(colonIndex + 1).trim();
                            return (
                              <div key={i} className="flex gap-2 text-[11px] font-mono leading-relaxed">
                                <span className="text-muted/50 shrink-0">{label}:</span>
                                <span className="text-white/70">{value}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* Production Pipeline */}
      <div className="rounded-card border border-line bg-panel p-8 space-y-10">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white tracking-tight">Ad Workflow</h2>
            <p className="text-[10px] font-mono text-muted uppercase tracking-widest opacity-60">Step-by-step ad creation</p>
          </div>
        </div>

        {!hasSelectedRunWithJobs ? (
          <div className="rounded-card border border-line/50 bg-transparent p-12 text-center space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-mono text-white uppercase tracking-widest">No workflow started</p>
              <p className="text-[11px] text-muted max-w-md mx-auto leading-relaxed">
                Start a workflow to see your ad jobs and progress here.
              </p>
            </div>
            <button
              onClick={() => handleStepRunClick(steps[0])}
              className="btn btn-primary !min-h-[44px] px-8 text-[11px] font-black uppercase tracking-[0.2em]"
            >
              Start Workflow
            </button>
          </div>
        ) : (
        <div>
          {visibleSteps.map((step, index) => {
            const scriptSources =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptResearchSources(step.lastJob.resultSummary)
                : null;
            const scriptId =
              step.key === "script" && step.status === "completed" && step.lastJob
                ? getScriptIdFromJob(step.lastJob)
                : null;
            const isScriptPanelOpen = Boolean(scriptId && scriptPanelOpenId === scriptId);
            const isStoryboardRelatedStep =
              step.key === "storyboard" ||
              step.key === "image_prompts" ||
              step.key === "video_prompts" ||
              step.key === "video_images" ||
              step.key === "video" ||
              step.key === "review";
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
                      startTime: panel.startTime,
                      endTime: panel.endTime,
                      prompt: String(panel.videoPrompt ?? "").trim(),
                    }))
                : [];
            const sceneFlowRows =
              step.key === "video_images" || step.key === "video" || step.key === "review"
                ? [...storyboardPanels]
                    .sort((a, b) => {
                      const aNum = Number(a.sceneNumber) || 0;
                      const bNum = Number(b.sceneNumber) || 0;
                      return aNum - bNum;
                    })
                    .map((panel, index) => {
                      const sceneNumber = Number(panel.sceneNumber) || index + 1;
                      const firstFrameImageUrl = String(
                        panel?.firstFrameImageUrl || (panel as any)?.firstFrameUrl || "",
                      ).trim();
                      const lastFrameImageUrl = String(
                        panel?.lastFrameImageUrl || (panel as any)?.lastFrameUrl || "",
                      ).trim();
                      // Review should only unlock when this run has a completed
                      // first-frame job for this specific scene and URLs exist.
                      const imageJobForScene = jobsInActiveRun.find((job) => {
                        if (job.type !== "VIDEO_IMAGE_GENERATION") return false;
                        if (job.status !== "COMPLETED") return false;
                        const payload = (job.payload as any) ?? {};
                        const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
                        return tasks.some((t: any) => Number(t.sceneNumber) === sceneNumber);
                      });
                      const hasImages = Boolean(imageJobForScene && (firstFrameImageUrl || lastFrameImageUrl));
                      const videoUrl = getSceneVideoUrl(panel);
                      const hasVideo = Boolean(videoUrl);
                      return {
                        sceneNumber,
                        panel: panel ?? null,
                        firstFrameImageUrl: firstFrameImageUrl || null,
                        lastFrameImageUrl: (lastFrameImageUrl || firstFrameImageUrl) || null,
                        approved: Boolean(panel?.approved),
                        hasImages,
                        hasVideo,
                        videoUrl: videoUrl || null,
                        locked: step.locked || !panel,
                        lockReason: !panel
                          ? "Scene missing from storyboard."
                          : step.locked
                            ? step.lockReason || "Blocked by pipeline prerequisites."
                            : undefined,
                        isReviewOpen: Boolean(sceneReviewOpenByNumber[sceneNumber]),
                        isVideoReviewOpen: Boolean(sceneVideoReviewOpenByNumber[sceneNumber]),
                      };
                    })
                : [];
            const isOutputViewMode = isViewableCompleted && !isOutputExpanded;
            const usesBottomOutputToggle = isViewableCompleted;
            const isSceneControlStep = step.key === "video_images" || step.key === "video";
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
            const isPrimaryActionDisabled = isSceneControlStep
              ? true
              : usesBottomOutputToggle
              ? !step.canRun || step.locked || step.status === "running" || submitting === step.key
              : isOutputViewMode
                ? submitting === step.key
                : !step.canRun || step.locked || step.status === "running" || submitting === step.key;
            const primaryActionLabel = isSceneControlStep
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
            const isCollapsed =
              isStepCollapsed(step.key, step.status) &&
              step.status !== "running";
            return (
              <div
                key={step.key}
                className={`rounded-card border overflow-hidden transition-all duration-300 mb-4 ${
                  step.status === "running"
                    ? "border-accent/40 bg-transparent"
                    : step.status === "failed"
                    ? "border-danger/30 bg-transparent"
                    : isCollapsed
                    ? "border-line/40 bg-transparent opacity-70 hover:opacity-100"
                    : "border-line bg-transparent"
                }`}
              >
                <div
                  className={`px-6 py-4 flex items-center justify-between gap-6 ${!isCollapsed ? "border-b border-line/20" : ""} ${step.status === "completed" ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (step.status === "completed" || step.status === "not_started" || step.status === "failed") {
                      toggleStepCollapsed(step.key, step.status);
                    }
                  }}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`w-7 h-7 rounded-card border flex items-center justify-center text-[10px] font-mono font-bold shrink-0 ${
                      step.status === "completed" ? "border-accent/30 text-accent bg-accent/5" :
                      step.status === "running" ? "border-accent text-accent animate-pulse" :
                      step.status === "failed" ? "border-danger/30 text-danger" :
                      "border-line text-muted/40"
                    }`}>
                      {step.status === "completed" ? "✓" : String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <h3 className={`text-[13px] font-black uppercase tracking-widest ${isCollapsed ? "text-white/50" : "text-white"}`}>
                        {step.label}
                      </h3>
                      {!isCollapsed && (
                        <p className="text-xs text-muted/80">{step.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                    {step.status === "running" && (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-accent uppercase tracking-widest animate-pulse">
                        <Spinner />
                        <span>Running</span>
                      </div>
                    )}
                    {step.status === "failed" && (
                      <div className="status-chip !px-3 !py-1 text-[8px] font-bold uppercase tracking-widest bg-danger/10 text-danger border-danger/20">
                        Failed
                      </div>
                    )}
                    {isCancelableJob(step.lastJob) && step.lastJob && (
                      <button
                        type="button"
                        onClick={() => void cancelJob(step.lastJob!.id)}
                        disabled={Boolean(cancellingJobIds[step.lastJob.id])}
                        className="btn btn-danger !min-h-[28px] px-4 text-[9px] uppercase font-bold tracking-widest"
                      >
                        {cancellingJobIds[step.lastJob.id] ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                    {isCollapsed ? (
                      <button
                        type="button"
                        onClick={() => toggleStepCollapsed(step.key, step.status)}
                        className="btn btn-secondary !min-h-[28px] px-4 text-[9px] uppercase font-bold tracking-widest opacity-50 hover:opacity-100"
                      >
                        Expand
                      </button>
                    ) : !isSceneControlStep ? (
                      <button
                        onClick={() => handleStepRunClick(step)}
                        disabled={isPrimaryActionDisabled}
                        className={`btn ${isPrimaryActionDisabled ? "btn-secondary opacity-50" : "btn-primary"} !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest flex items-center gap-2`}
                      >
                        {submitting === step.key && <Spinner />}
                        {primaryActionLabel}
                      </button>
                    ) : runningVideoImageJobId ? (
                      <button
                        type="button"
                        onClick={() => void handleResetVideoImageJob(runningVideoImageJobId)}
                        disabled={isResettingVideoImageJob}
                        className="btn btn-danger !min-h-[30px] px-4 text-[8px] uppercase font-bold tracking-widest"
                      >
                        {isResettingVideoImageJob ? "Resetting..." : "Reset Scene"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className={`px-6 ${isOutputExpanded && (step.key === "storyboard" || step.key === "video_prompts") ? "py-0" : "py-4"}`}>
                      {step.locked && (
                        <div className="flex items-center gap-2 text-[10px] font-mono text-muted uppercase tracking-widest opacity-60 mb-4 animate-pulse">
                          <span>Locked:</span>
                          <span>{step.lockReason}</span>
                        </div>
                      )}
                      {isStuckImagePromptStep && (
                        <div className="p-3 rounded-card border border-accent/20 bg-accent/5 text-[10px] font-mono text-accent uppercase tracking-widest mb-4">
                          This step is stuck. Re-run it to continue.
                        </div>
                      )}
                      {step.lastJob && step.status !== "failed" && step.status !== "running" && (
                        <div className={`flex items-center justify-between gap-4 ${isOutputExpanded && (step.key === "storyboard" || step.key === "video_prompts") ? "py-4" : ""}`}>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-muted font-mono leading-relaxed">
                              {getSummaryText(step.lastJob.resultSummary, step.lastJob)}
                            </span>
                            <span className="text-[10px] font-mono text-muted opacity-40">
                              {new Date(step.lastJob.updatedAt ?? step.lastJob.createdAt).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {step.key === "script" && scriptId && (
                              <>
                                {isScriptPanelOpen && (
                                  scriptPanelEditMode ? (
                                    <>
                                      <button
                                        onClick={() => { setScriptPanelEditMode(false); setScriptPanelError(null); }}
                                        disabled={scriptPanelSaving}
                                        className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => void handleSaveScriptPanelEdits()}
                                        disabled={scriptPanelSaving}
                                        className="btn btn-primary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                      >
                                        {scriptPanelSaving ? "Saving..." : "Save Changes"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        const beats = extractScriptBeats(scriptPanelData?.rawJson);
                                        setScriptPanelDraftBeats(beats);
                                        setScriptPanelCombinedVoDraft(buildCombinedVoDraftFromBeats(beats));
                                        setScriptPanelEditMode(true);
                                      }}
                                      className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                    >
                                      Edit Script
                                    </button>
                                  )
                                )}
                                <button
                                  type="button"
                                  onClick={() => { if (isScriptPanelOpen) { closeScriptPanel(); } else { void loadScriptPanel(scriptId); } }}
                                  className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                >
                                  {isScriptPanelOpen ? "Close Script" : "View Script"}
                                </button>
                              </>
                            )}
                            {usesBottomOutputToggle && !(isOutputExpanded && (step.key === "storyboard" || step.key === "video_prompts")) && (
                              <button
                                type="button"
                                onClick={() => toggleCompletedStepOutput(step.key)}
                                className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                              >
                                {getOutputToggleLabel(step, isOutputExpanded)}
                              </button>
                            )}
                            {step.key === "storyboard" && isOutputExpanded && (
                              <>
                                <button
                                  onClick={storyboardEditMode ? cancelStoryboardEditMode : openStoryboardEditMode}
                                  className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                >
                                  {storyboardEditMode ? "Cancel Edit" : "Edit Storyboard"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleCompletedStepOutput(step.key)}
                                  className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                >
                                  {getOutputToggleLabel(step, true)}
                                </button>
                                {storyboardEditMode && (
                                  <button
                                    onClick={() => void handleSaveStoryboardEdits()}
                                    disabled={storyboardSaving}
                                    className="btn btn-primary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {storyboardSaving ? "Saving..." : "Save Storyboard"}
                                  </button>
                                )}
                              </>
                            )}
                            {step.key === "video_prompts" && isOutputExpanded && (
                              <>
                                <button
                                  onClick={videoPromptEditMode ? cancelVideoPromptEditMode : openVideoPromptEditMode}
                                  className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                >
                                  {videoPromptEditMode ? "Cancel Edit" : "Edit Prompts"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleCompletedStepOutput(step.key)}
                                  className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                >
                                  {getOutputToggleLabel(step, true)}
                                </button>
                                {videoPromptEditMode && (
                                  <button
                                    onClick={() => void handleSaveVideoPromptEdits()}
                                    disabled={videoPromptSaving}
                                    className="btn btn-primary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {videoPromptSaving ? "Saving..." : "Save Changes"}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {hasSelectedRunWithJobs && step.status === "failed" && Boolean(step.lastJob?.error) && (
                        <div className="rounded-card border border-danger/30 bg-danger/5 p-4 flex items-start gap-4">
                          <div className="w-2 h-2 rounded-full bg-danger mt-1 animate-pulse shrink-0" />
                          <div className="flex-1">
                            <p className="text-[10px] font-mono text-danger uppercase tracking-widest font-bold mb-1">Error</p>
                            <p className="text-[11px] font-mono text-danger/80 leading-relaxed">{getErrorText(step.lastJob?.error)}</p>
                          </div>
                        </div>
                      )}
                    </div>

              {step.key === "video_images" && (
                <div className="space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard data is missing</p>
                    </div>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading scene data...</p>
                    </div>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {storyboardPanelError}
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {sceneActionError && (
                        <div className="mx-2 p-4 rounded-card border border-danger/20 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                          Error: {sceneActionError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sceneFlowRows.map((row) => {
                          const isGenerating = sceneGeneratingNumber === row.sceneNumber;
                          const hasImage = Boolean(row.firstFrameImageUrl);
                          const isReviewOpen = row.isReviewOpen;
                          
                          return (
                            <div
                              key={`scene-flow-${row.sceneNumber}`}
                              className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300"
                            >
                              <div className="px-5 py-3 bg-panel border-b border-line/10 flex items-center justify-between">
                                <span className="text-[10px] font-mono text-accent font-bold">Scene {String(row.sceneNumber).padStart(2, "0")}</span>
                                <div className="status-chip subtle !px-3 !py-1 uppercase tracking-widest text-[8px] font-bold">
                                  {isGenerating ? "Generating" : row.hasImages ? "Ready" : "Waiting"}
                                </div>
                              </div>
                              <div className="p-5 space-y-4">
                                {isReviewOpen && row.firstFrameImageUrl ? (
                                  <a
                                    href={row.firstFrameImageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-card border border-line bg-bg-elevated transition-colors hover:border-accent/30"
                                  >
                                    <div className="px-3 py-2 bg-panel border-b border-line/10 flex items-center justify-between gap-3">
                                      <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-60">
                                        Generated Image
                                      </span>
                                      <span className="text-[8px] font-mono text-accent uppercase tracking-[0.2em]">
                                        Open Full Size
                                      </span>
                                    </div>
                                    <div className="aspect-[9/16] overflow-hidden bg-bg">
                                      <img
                                        src={row.firstFrameImageUrl}
                                        alt={`Scene ${row.sceneNumber} generated first frame`}
                                        className="h-full w-full object-cover"
                                      />
                                    </div>
                                  </a>
                                ) : null}

                                <div className="space-y-2">
                                  <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Voiceover</span>
                                  <div className="bg-panel border border-line/10 rounded-card p-3 text-[11px] text-white/50 font-mono leading-relaxed min-h-[60px] line-clamp-3">
                                    {row.panel?.vo || "No voiceover available"}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                  <button
                                    onClick={() => void handleGenerateScene(row.sceneNumber)}
                                    disabled={isGenerating || submitting === step.key}
                                    className="btn btn-secondary flex-1 !min-h-[32px] text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {isGenerating ? "Processing..." : row.hasImages ? "Regenerate Images" : "Generate Images"}
                                  </button>
                                  <button
                                    onClick={() => toggleSceneReview(row.sceneNumber)}
                                    disabled={!hasImage}
                                    className="btn btn-secondary !min-h-[32px] px-4 text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {isReviewOpen ? "Hide" : "Preview"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.key === "video" && (
                <div className="space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard data is missing</p>
                    </div>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading video data...</p>
                    </div>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {storyboardPanelError}
                    </div>
                  ) : (
                    <div className="space-y-8">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sceneFlowRows.map((row) => {
                          const isGenerating = videoGeneratingNumber === row.sceneNumber;
                          const hasVideo = row.hasVideo;
                          const videoUrl = String(row.videoUrl || "").trim();
                          const isReviewOpen = row.isVideoReviewOpen;
                          return (
                            <div
                              key={`scene-video-${row.sceneNumber}`}
                              className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300"
                            >
                              <div className="px-5 py-3 bg-panel border-b border-line/10 flex items-center justify-between">
                                <span className="text-[10px] font-mono text-accent font-bold">Scene {String(row.sceneNumber).padStart(2, "0")}</span>
                                <div className="status-chip subtle !px-3 !py-1 uppercase tracking-widest text-[8px] font-bold">
                                  {isGenerating ? "Generating" : hasVideo ? "Ready" : "Waiting"}
                                </div>
                              </div>

                              {row.locked && row.lockReason && (
                                <div className="px-5 py-2 flex items-center gap-2 text-[9px] font-mono text-muted uppercase tracking-widest opacity-60 bg-panel border-b border-line/5">
                                  <span>Locked:</span>
                                  <span>{row.lockReason}</span>
                                </div>
                              )}

                              <div className="p-5 space-y-4">
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => void handleGenerateSceneVideo(row.sceneNumber)}
                                    disabled={row.locked || isGenerating || videoGeneratingNumber !== null || submitting === step.key}
                                    className="btn btn-secondary flex-1 !min-h-[32px] text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {isGenerating ? "Generating..." : hasVideo ? "Re-render" : "Generate Video"}
                                  </button>
                                  <button
                                    onClick={() => toggleSceneVideoReview(row.sceneNumber)}
                                    disabled={!hasVideo}
                                    className="btn btn-secondary !min-h-[32px] px-4 text-[9px] uppercase font-bold tracking-widest"
                                  >
                                    {isReviewOpen ? "Hide" : "Preview"}
                                  </button>
                                </div>

                                {isReviewOpen && hasVideo && (
                                  <div className="pt-2 animate-in fade-in zoom-in-95 duration-300">
                                    <video
                                      src={videoUrl}
                                      controls
                                      className="w-full aspect-[9/16] rounded-card border border-line shadow-inner bg-panel"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isCollapsed && step.key === "review" && (
                <div className="space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard data is missing</p>
                    </div>
                  ) : (
                    <div className="rounded-card border border-line bg-transparent overflow-hidden">
                       <VideoEditorStep
                         storyboardId={storyboardId}
                         projectId={projectId}
                         scenes={storyboardPanels
                           .filter((p) => Boolean(p.videoUrl))
                           .map((p) => ({
                             sceneId: String((p as any).sceneId ?? p.id ?? p.sceneNumber ?? ""),
                             sceneNumber: Number(p.sceneNumber) || 0,
                             videoUrl: p.videoUrl,
                             beatLabel: String(p.beatLabel ?? ""),
                             vo: String(p.vo ?? ""),
                             durationSec: typeof p.clipDurationSeconds === "number" ? p.clipDurationSeconds : undefined,
                           }))}
                         onComplete={(nextMergedVideoUrl) => {
                           setMergedVideoUrl(nextMergedVideoUrl);
                         }}
                       />
                    </div>
                  )}
                </div>
              )}

              {step.key === "script" && step.status === "completed" && isScriptPanelOpen && (
                <div className="mt-6 space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {scriptPanelLoading ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading script...</p>
                    </div>
                  ) : scriptPanelError ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {scriptPanelError}
                    </div>
                  ) : scriptPanelData ? (
                    <div className="space-y-6">
                      <div className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300">
                        <div className="px-8 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <span className="text-[11px] font-mono text-accent-2 font-bold tracking-tighter uppercase whitespace-pre">Script</span>
                            <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">
                              {scriptPanelData.wordCount ?? "---"} Words
                            </span>
                          </div>
                        </div>
                        <div className="p-8">
                          {scriptPanelEditMode ? (
                            <div className="space-y-6">
                              <div className="p-4 rounded-card border border-accent-2/20 bg-accent-2/5 text-[10px] font-mono text-accent-2 uppercase tracking-widest leading-relaxed">
                                <span className="opacity-60">Note:</span> Keep the &quot;Beat N:&quot; headers so the sequence stays in order.
                              </div>
                              <textarea
                                value={scriptPanelCombinedVoDraft}
                                onChange={(e) => setScriptPanelCombinedVoDraft(e.target.value)}
                                className="w-full bg-panel border border-line/40 rounded-card p-6 text-[13px] font-mono text-white/70 focus:border-accent-2/40 focus:ring-1 focus:ring-accent-2/20 transition-all min-h-[400px] leading-relaxed"
                              />
                            </div>
                          ) : (
                            <div className="text-[14px] text-white/80 leading-[1.8] whitespace-pre-wrap font-mono selection:bg-accent-2/30 selection:text-white">
                              {buildCombinedVoDraftFromBeats(extractScriptBeats(scriptPanelData.rawJson)) || "No script available"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-12 text-center text-muted text-[10px] font-mono uppercase tracking-widest border border-line/20 rounded-card bg-transparent">
                      Script reference is missing
                    </div>
                  )}
                </div>
              )}

              {scriptSources && isScriptPanelOpen && (
                <div className="mt-6 border border-line/10 rounded-card bg-panel overflow-hidden">
                  <details className="group">
                    <summary className="px-6 py-4 cursor-pointer flex items-center justify-between text-[10px] font-mono text-muted uppercase tracking-widest font-bold hover:bg-panel transition-colors list-none">
                      <div className="flex items-center gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        Source Inputs
                      </div>
                      <span className="opacity-40 transition-transform group-open:rotate-180">▼</span>
                    </summary>
                    <div className="px-8 pb-6 pt-2 space-y-3">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-muted/60 uppercase tracking-widest">Customer Research:</span>
                        <span className="text-accent-2">{formatMetadataDate(scriptSources.customerAnalysisRunDate)}</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-muted/60 uppercase tracking-widest">Ad Analysis:</span>
                        <span className="text-accent-2">{formatMetadataDate(scriptSources.patternAnalysisRunDate)}</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-muted/60 uppercase tracking-widest">Product Research:</span>
                        <span className="text-accent-2">{formatMetadataDate(scriptSources.productIntelDate)}</span>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {step.key === "storyboard" && step.status === "completed" && isOutputExpanded && (
                <div className="mt-6 space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard could not be loaded</p>
                    </div>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading storyboard...</p>
                    </div>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {storyboardPanelError}
                    </div>
                  ) : storyboardPanels.length === 0 ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest">No storyboard scenes available</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {storyboardSaveError && (
                        <div className="mx-2 p-4 rounded-card border border-danger/20 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                          Save failed: {storyboardSaveError}
                        </div>
                      )}

                      <div className="space-y-8">
                        {(storyboardEditMode ? storyboardDraftPanels : storyboardPanels).map((panel, panelIndex) => (
                          <div
                            key={`${panel.beatLabel}-${panel.startTime}-${panel.endTime}-${panelIndex}`}
                            className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300"
                          >
                            <div className="px-6 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
                              <div className="flex items-center gap-6">
                                <span className="text-[11px] font-mono text-accent font-bold tracking-tighter">
                                  Scene {String(panelIndex + 1).padStart(2, "0")}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">Timing:</span>
                                  <span className="text-[10px] font-mono text-white font-bold">{formatStoryboardPanelTiming(panel)}</span>
                                </div>
                                <div className="status-chip subtle !px-3 !py-1 uppercase tracking-widest text-[8px] font-bold">
                                  {panel.panelType === "B_ROLL_ONLY" ? "Cutaway" : "Primary"}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {storyboardEditMode ? (
                                  <div className="flex items-center gap-2">
                                    <div className="flex rounded-card border border-line overflow-hidden">
                                      <button
                                        type="button"
                                        onClick={() => handleMoveStoryboardPanel(panelIndex, -1)}
                                        disabled={panelIndex === 0 || storyboardSaving}
                                        className="btn btn-secondary !min-h-[26px] !rounded-none border-0 px-3 text-[10px] flex items-center justify-center"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleMoveStoryboardPanel(panelIndex, 1)}
                                        disabled={panelIndex === storyboardDraftPanels.length - 1 || storyboardSaving}
                                        className="btn btn-secondary !min-h-[26px] !rounded-none border-l border-line px-3 text-[10px] flex items-center justify-center"
                                      >
                                        ↓
                                      </button>
                                    </div>
                                    {panelIndex < storyboardDraftPanels.length - 1 &&
                                      storyboardDraftPanels[panelIndex].panelType === storyboardDraftPanels[panelIndex + 1]?.panelType && (
                                      <button
                                        type="button"
                                        onClick={() => mergeStoryboardPanels(panelIndex)}
                                        disabled={storyboardSaving}
                                        className="btn btn-secondary !min-h-[26px] px-3 text-[8px] font-black uppercase tracking-widest text-accent-2 border-accent-2/30 bg-accent-2/5"
                                      >
                                        Merge_Next
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void handleRegenerateStoryboardPanel(panelIndex)}
                                      disabled={storyboardRegeneratingIndex === panelIndex || storyboardSaving}
                                      className="btn btn-secondary !min-h-[26px] px-3 text-[8px] font-black uppercase tracking-widest text-accent border-accent/30 bg-accent/5"
                                    >
                                      {storyboardRegeneratingIndex === panelIndex ? "Generating..." : "Regenerate"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteStoryboardPanel(panelIndex)}
                                      disabled={storyboardDraftPanels.length <= 1 || storyboardSaving}
                                      className="btn btn-danger !min-h-[26px] px-3 text-[8px] font-black uppercase tracking-widest"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="p-8 space-y-8 bg-panel">
                              {storyboardEditMode ? (
                                <div className="space-y-4 pt-1">
                                  <div className="flex items-center justify-between border-b border-line/5 pb-2">
                                    <span className="text-[9px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Storyboard Editor</span>
                                    <span className="text-[8px] font-mono text-accent/60 uppercase tracking-widest font-bold">Manual Edit Active</span>
                                  </div>
                                  <textarea
                                    value={storyboardBeatEditorDrafts[panelIndex] ?? buildStoryboardBeatEditorText(panel)}
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setStoryboardBeatEditorDrafts((prev) =>
                                        storyboardDraftPanels.map((draftPanel, index) =>
                                          index === panelIndex
                                            ? nextValue
                                            : typeof prev[index] === "string"
                                              ? prev[index]
                                              : buildStoryboardBeatEditorText(draftPanel)
                                        )
                                      );
                                      const parsed = parseStoryboardBeatEditorText(nextValue, panel);
                                      updateStoryboardDraftPanel(panelIndex, (prev) => ({
                                        ...prev,
                                        ...parsed,
                                      }));
                                    }}
                                    className="w-full bg-panel border border-line/40 rounded-card p-6 text-[12px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all leading-relaxed min-h-[240px]"
                                  />
                                  <div className="flex justify-start pt-2">
                                    <button
                                      type="button"
                                      onClick={() => handleAddStoryboardPanel(panelIndex)}
                                      disabled={storyboardSaving}
                                      className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                    >
                                      + Add Scene
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="w-full bg-transparent border border-line/20 rounded-card p-6 text-[12px] font-mono text-white/70 leading-relaxed min-h-[240px] whitespace-pre-wrap">
                                    {buildStoryboardBeatEditorText(panel) || "No storyboard available"}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {step.key === "image_prompts" && step.status === "completed" && isOutputExpanded && (
                <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard data is missing</p>
                    </div>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading image prompts...</p>
                    </div>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {storyboardPanelError}
                    </div>
                  ) : imagePromptRows.length === 0 ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest">No video prompt available</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-mono text-accent uppercase tracking-widest font-bold">Image Prompts</span>
                          <span className="text-[11px] font-mono text-muted uppercase tracking-widest opacity-40">
                             {imagePromptEditMode
                              ? `Editing: ${imagePromptDrafts.length} scenes`
                              : `${imagePromptRows.length} scenes`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                           {imagePromptEditMode && (
                             <button
                               onClick={() => void handleSaveImagePromptEdits()}
                               disabled={imagePromptSaving}
                               className="btn btn-primary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                             >
                               {imagePromptSaving ? "Saving..." : "Save Changes"}
                             </button>
                           )}
                           <button
                             onClick={imagePromptEditMode ? cancelImagePromptEditMode : openImagePromptEditMode}
                             className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                           >
                             {imagePromptEditMode ? "Cancel Edit" : "Edit Prompts"}
                           </button>
                        </div>
                      </div>

                      {imagePromptSaveError && (
                        <div className="mx-2 p-4 rounded-card border border-danger/20 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                          Save failed: {imagePromptSaveError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
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
                              className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300"
                            >
                              <div className="px-6 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
                                <span className="text-[11px] font-mono text-accent font-bold tracking-tighter">Scene {String(row.sceneNumber).padStart(2, "0")}</span>
                                <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Image Prompts</span>
                              </div>
                              <div className="p-6 space-y-6">
                                <div className="space-y-3">
                                  <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Voiceover</span>
                                  <div className="bg-panel border border-line/10 rounded-card p-4 text-[12px] text-white/60 leading-relaxed italic">
                                    &quot;{row.vo || "No voiceover available"}&quot;
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                  <div className="space-y-3">
                                    <span className="text-[8px] font-mono text-accent-2/60 uppercase tracking-[0.2em]">First Frame Prompt</span>
                                    {imagePromptEditMode ? (
                                      <textarea
                                        value={firstFramePrompt}
                                        onChange={(event) =>
                                          updateImagePromptDraft(row.panelIndex, {
                                            firstFramePrompt: event.target.value,
                                          })
                                        }
                                        disabled={imagePromptSaving}
                                        className="w-full bg-panel border border-line/40 rounded-card p-4 text-[11px] font-mono text-white/70 focus:border-accent-2/40 focus:ring-1 focus:ring-accent-2/20 transition-all min-h-[120px]"
                                      />
                                    ) : (
                                      <div className="w-full bg-transparent border border-line/20 rounded-card p-4 text-[11px] font-mono text-accent-2/70 leading-relaxed min-h-[120px]">
                                        {firstFramePrompt || "No prompt"}
                                      </div>
                                    )}
                                  </div>
                                  <div className="space-y-3">
                                    <span className="text-[8px] font-mono text-accent/60 uppercase tracking-[0.2em]">Last Frame Prompt</span>
                                    {imagePromptEditMode ? (
                                      <textarea
                                        value={lastFramePrompt}
                                        onChange={(event) =>
                                          updateImagePromptDraft(row.panelIndex, {
                                            lastFramePrompt: event.target.value,
                                          })
                                        }
                                        disabled={imagePromptSaving}
                                        className="w-full bg-panel border border-line/40 rounded-card p-4 text-[11px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all min-h-[120px]"
                                      />
                                    ) : (
                                      <div className="w-full bg-transparent border border-line/20 rounded-card p-4 text-[11px] font-mono text-accent/70 leading-relaxed min-h-[120px]">
                                        {lastFramePrompt || "No prompt"}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.key === "video_prompts" && step.status === "completed" && isOutputExpanded && (
                <div className="mt-6 space-y-6 px-6 pb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                  {!storyboardId ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest leading-relaxed">Storyboard data is missing</p>
                    </div>
                  ) : storyboardPanelLoading && storyboardMatchesCurrentFetch ? (
                    <div className="p-16 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Loading video prompts...</p>
                    </div>
                  ) : storyboardPanelError && storyboardMatchesCurrentFetch ? (
                    <div className="p-12 text-center text-danger text-[10px] font-mono uppercase tracking-widest border border-danger/20 rounded-card bg-danger/5">
                      Error: {storyboardPanelError}
                    </div>
                  ) : videoPromptRows.length === 0 ? (
                    <div className="rounded-card border border-danger/30 bg-danger/5 p-12 text-center">
                      <p className="text-[10px] font-mono text-danger uppercase tracking-widest">No video prompts available</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {videoPromptSaveError && (
                        <div className="mx-2 p-4 rounded-card border border-danger/20 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                          Save failed: {videoPromptSaveError}
                        </div>
                      )}

                      <div className="space-y-6">
                        {videoPromptRows.map((row) => {
                          const promptValue = videoPromptEditMode
                            ? String(videoPromptDrafts[row.panelIndex] ?? row.prompt)
                            : row.prompt;

                          return (
                            <div
                              key={`video-prompt-${row.panelIndex}`}
                              className="rounded-card border border-line bg-panel overflow-hidden group hover:border-accent/30 transition-all duration-300"
                            >
                              <div className="px-6 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                  <span className="text-[11px] font-mono text-accent font-bold tracking-tighter">
                                    Scene {String(row.panelIndex + 1).padStart(2, "0")}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">Timing:</span>
                                    <span className="text-[10px] font-mono text-white font-bold">
                                      {formatStoryboardPanelTiming({
                                        startTime: row.startTime,
                                        endTime: row.endTime,
                                      } as StoryboardPanel)}
                                    </span>
                                  </div>
                                  <div className="status-chip subtle !px-3 !py-1 uppercase tracking-widest text-[8px] font-bold">
                                    {row.panelType === "B_ROLL_ONLY" ? "Cutaway" : "Primary"}
                                  </div>
                                </div>
                              </div>
                              <div className="p-8 space-y-8 bg-panel">
                                {videoPromptEditMode ? (
                                  <div className="space-y-4 pt-1">
                                    <div className="flex items-center justify-between border-b border-line/5 pb-2">
                                      <span className="text-[9px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Prompt Editor</span>
                                      <span className="text-[8px] font-mono text-accent/60 uppercase tracking-widest font-bold">Manual Edit Active</span>
                                    </div>
                                    <textarea
                                      value={promptValue}
                                      onChange={(event) =>
                                        updateVideoPromptDraft(row.panelIndex, event.target.value)
                                      }
                                      disabled={videoPromptSaving}
                                      className="w-full bg-panel border border-line/40 rounded-card p-6 text-[12px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all leading-relaxed min-h-[240px]"
                                    />
                                    <div className="flex justify-start pt-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleRegenerateVideoPrompt(row.panelIndex)}
                                        disabled={videoPromptRegeneratingIndex === row.panelIndex || videoPromptSaving}
                                        className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest"
                                      >
                                        {videoPromptRegeneratingIndex === row.panelIndex ? "Generating..." : "Regenerate Prompt"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="w-full bg-transparent border border-line/20 rounded-card p-5 text-[13px] font-mono text-accent-2/70 leading-relaxed min-h-[100px] whitespace-pre-wrap">
                                      {promptValue || "No prompt"}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.status === "running" && (
                <div className="mt-6 flex items-center gap-3 px-4 py-3 rounded-card border border-accent/20 bg-accent/5 animate-pulse">
                  <Spinner />
                  <span className="text-[10px] font-mono text-accent uppercase tracking-widest font-bold">Generation in progress...</span>
                </div>
              )}

              {hasSelectedRunWithJobs && step.status === "failed" && Boolean(step.lastJob?.error) && (
                <div className="mt-6 rounded-card border border-danger/30 bg-danger/5 p-4 flex items-start gap-4">
                  <div className="w-2 h-2 rounded-full bg-danger mt-1 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-[10px] font-mono text-danger uppercase tracking-widest font-bold mb-1">Job failed</p>
                    <p className="text-[11px] font-mono text-danger/80 leading-relaxed">{getErrorText(step.lastJob?.error)}</p>
                  </div>
                </div>
              )}
                  </>
                )}
            </div>
          );
        })}
      </div>
    )}
  </div>

      {showScriptModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-overlay backdrop-blur-sm animate-in fade-in duration-300" onClick={() => { if (!scriptModalSubmitting) { setShowScriptModal(false); resetScriptModal(); } }}>
          <div className="w-full max-w-2xl bg-bg border border-line rounded-card overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
              <span className="text-[11px] font-mono text-accent font-bold uppercase tracking-widest">Create Script</span>
              <button
                onClick={() => { if (!scriptModalSubmitting) { setShowScriptModal(false); resetScriptModal(); } }}
                className="text-muted hover:text-white transition-colors text-xl font-mono"
              >
                ×
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              {scriptModalMode === "choose" ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Choose Method</span>
                    <p className="text-[12px] text-white/50 leading-relaxed">Select the synthesis architecture for this script iteration.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <button onClick={() => void handleChooseGenerateWithAi("swipe_template")} disabled={scriptModalSubmitting} className="btn btn-secondary !justify-start px-6 py-4 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                      <div className="text-left space-y-1">
                        <div className="text-[11px] font-mono text-accent uppercase tracking-widest group-hover:text-accent transition-colors">Select Ad Template From Swipe</div>
                        <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Leverage existing high-performance creative structures.</div>
                      </div>
                    </button>
                    <button onClick={() => void handleChooseGenerateWithAi("research_formula")} disabled={scriptModalSubmitting} className="btn btn-secondary !justify-start px-6 py-4 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                      <div className="text-left space-y-1">
                        <div className="text-[11px] font-mono text-accent uppercase tracking-widest group-hover:text-accent transition-colors">Use Formula From Research</div>
                        <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Derive script structure from validated market insights.</div>
                      </div>
                    </button>
                    <button onClick={() => void handleChooseGenerateWithAi("upload_template")} disabled={scriptModalSubmitting} className="btn btn-secondary !justify-start px-6 py-4 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                      <div className="text-left space-y-1">
                        <div className="text-[11px] font-mono text-accent uppercase tracking-widest group-hover:text-accent transition-colors">Upload Transcript As Template</div>
                        <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Use your own transcript as the starting point.</div>
                      </div>
                    </button>
                    <button onClick={() => { setScriptModalMode("upload"); setScriptModalError(null); }} disabled={scriptModalSubmitting} className="btn btn-secondary !justify-start px-6 py-4 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                      <div className="text-left space-y-1">
                        <div className="text-[11px] font-mono text-muted uppercase tracking-widest group-hover:text-white transition-colors">Manual Script Setup</div>
                        <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Direct entry of pre-resolved audio assets.</div>
                      </div>
                    </button>
                  </div>
                </div>
              ) : scriptModalMode === "ai" ? (
                <div className="space-y-6">
                   <div className="space-y-2">
                    <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Research Sync</span>
                    <p className="text-[12px] text-white/50 leading-relaxed uppercase tracking-widest">Attach validated research unit to power inference.</p>
                  </div>

                  {scriptRunsLoading ? (
                    <div className="p-12 text-center animate-pulse">
                      <p className="text-[10px] font-mono text-muted uppercase tracking-widest">Querying_Research_Datastore...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {scriptResearchRuns.length === 0 ? (
                        <div className="space-y-4">
                          <div className="p-4 rounded-card border border-warning/30 bg-warning/5 text-[10px] font-mono text-warning uppercase tracking-widest leading-relaxed">
                            No validated research data found. Output may be generic.
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={scriptNoResearchAcknowledged}
                              onChange={(e) => setScriptNoResearchAcknowledged(e.target.checked)}
                              disabled={scriptModalSubmitting}
                              className="accent-accent"
                            />
                            <span className="text-[11px] font-mono text-muted group-hover:text-white transition-colors">Use standard generation</span>
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <span className="text-[9px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Available Research Runs</span>
                            <select
                              value={selectedScriptResearchJobId}
                              onChange={(e) => setSelectedScriptResearchJobId(e.target.value)}
                              disabled={scriptModalSubmitting}
                              className="w-full bg-panel border border-line/40 rounded-card px-4 py-3 text-[12px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all cursor-pointer"
                            >
                              {scriptResearchRuns.map((run) => {
                                const timestamp = new Date(run.createdAt).toLocaleString("en-US", {
                                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
                                });
                                return (
                                  <option key={run.jobId} value={run.jobId} className="bg-bg">
                                    {timestamp} {run.runId ? ` • Run ${run.runId}` : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          {selectedScriptResearchJobId && (
                            <div className="space-y-4">
                              <div className="flex flex-col gap-1 px-2">
                                <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">Job_Ref: {selectedScriptResearchJobId}</span>
                                {selectedScriptResearchRun?.runId && (
                                  <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">Run: {selectedScriptResearchRun.runId}</span>
                                )}
                              </div>

                              {scriptRunSummaryLoading ? (
                                <p className="text-[10px] font-mono text-muted uppercase tracking-widest px-2 animate-pulse">Loading source data...</p>
                              ) : scriptRunSummaryError ? (
                                <div className="p-4 rounded-card border border-danger/30 bg-danger/5 text-[10px] font-mono text-danger uppercase tracking-widest">Source data error: {scriptRunSummaryError}</div>
                              ) : scriptRunSummary ? (
                                <div className="rounded-card border border-line/10 bg-panel overflow-hidden divide-y divide-line/10">
                                  {(() => {
                                    const customer = getSourceRowContent(scriptRunSummary.customerAnalysis, String(scriptRunSummary.customerAnalysis.avatarSummary ?? ""));
                                    const pattern = getSourceRowContent(scriptRunSummary.patternAnalysis, "");
                                    const productLabel = String(scriptRunSummary.productCollection.productName ?? "").trim();
                                    const product = getSourceRowContent(scriptRunSummary.productCollection, [productLabel, scriptRunSummary.productCollection.completedAt ? formatMetadataDate(scriptRunSummary.productCollection.completedAt) : ""].filter(Boolean).join(" • "));
                                    
                                    return [
                                      { label: "Customer Research", value: customer.text, missing: customer.missing },
                                      { label: "Ad Analysis", value: pattern.text, missing: pattern.missing },
                                      { label: "Product Research", value: product.text, missing: product.missing },
                                    ].map((row) => (
                                      <div key={row.label} className="px-5 py-3 flex items-start justify-between gap-6 hover:bg-transparent transition-colors">
                                        <span className="text-[10px] font-mono text-muted font-bold uppercase tracking-widest opacity-60 shrink-0">{row.label}</span>
                                        <span className={`text-[10px] font-mono text-right leading-relaxed ${row.missing ? 'text-warning' : 'text-accent-2'}`}>
                                          {row.missing ? row.value : row.value}
                                        </span>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-4 pt-6 border-t border-line/10">
                         <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Script Strategy</span>
                         <div className="grid grid-cols-1 gap-3">
                           {[
                             { id: 'swipe_template', label: 'Use Swipe Ad', sub: 'Match a proven ad structure.' },
                             { id: 'research_formula', label: 'Use Research Formula', sub: 'Build from your research insights.' },
                             { id: 'upload_template', label: 'Upload Transcript', sub: 'Start from your own transcript.' },
                           ].map((strategy) => (
                             <label key={strategy.id} className={`flex items-start gap-4 p-4 rounded-card border transition-all cursor-pointer ${scriptGenerationStrategy === strategy.id ? 'border-accent bg-accent/5' : 'border-line/10 bg-transparent hover:border-line/30'}`}>
                               <input
                                 type="radio"
                                 name="script-strategy"
                                 value={strategy.id}
                                 checked={scriptGenerationStrategy === strategy.id}
                                 onChange={() => setScriptGenerationStrategy(strategy.id as any)}
                                 disabled={scriptModalSubmitting}
                                 className="mt-1 accent-accent"
                               />
                               <div className="space-y-1">
                                 <div className={`text-[11px] font-mono font-bold uppercase tracking-widest ${scriptGenerationStrategy === strategy.id ? 'text-accent' : 'text-white/70'}`}>{strategy.label}</div>
                                 <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">{strategy.sub}</div>
                               </div>
                             </label>
                           ))}
                         </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Manual Entry</span>
                    <p className="text-[12px] text-white/50 leading-relaxed uppercase tracking-widest">Skip AI and paste the transcript yourself.</p>
                  </div>
                  <textarea
                    value={scriptUploadText}
                    onChange={(e) => setScriptUploadText(e.target.value)}
                    disabled={scriptModalSubmitting}
                    placeholder="Enter audio directives here..."
                    className="w-full bg-panel border border-line/40 rounded-card p-6 text-[13px] font-mono text-white/70 focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all min-h-[300px] leading-relaxed placeholder:opacity-20"
                  />
                </div>
              )}
            </div>
            
            <div className="px-8 py-6 bg-panel border-t border-line/10 flex items-center justify-between">
              <button
                onClick={() => {
                  if (scriptModalSubmitting) return;
                  if (scriptModalMode === "choose") { setShowScriptModal(false); resetScriptModal(); }
                  else { setScriptModalMode("choose"); setScriptModalError(null); }
                }}
                className="btn btn-secondary !min-h-[40px] px-8 text-[10px] uppercase font-bold tracking-widest"
              >
                {scriptModalMode === "choose" ? "Dismiss" : "Return"}
              </button>
              <button
                onClick={scriptModalMode === "upload" ? handleUploadScript : () => {
                   if (scriptModalMode === "choose") { /* handled in button grid */ } else { handleGenerateScriptWithAi(); }
                }}
                disabled={scriptModalSubmitting}
                className="btn btn-primary !min-h-[40px] px-10 text-[10px] uppercase font-bold tracking-widest"
              >
                {scriptModalSubmitting ? "Generating..." : scriptModalMode === "upload" ? "Save Script" : "Generate Script"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStoryboardModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-overlay backdrop-blur-sm animate-in fade-in duration-300" onClick={() => { if (!storyboardModalSubmitting) { setShowStoryboardModal(false); setStoryboardModalMode("choose"); setManualStoryboardPanels([]); } }}>
          <div className="w-full max-w-2xl bg-bg border border-line rounded-card overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 max-h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 bg-panel border-b border-line/10 flex items-center justify-between">
              <span className="text-[11px] font-mono text-accent font-bold uppercase tracking-widest">Storyboard Builder</span>
              <button
                onClick={() => { if (!storyboardModalSubmitting) { setShowStoryboardModal(false); setStoryboardModalMode("choose"); setManualStoryboardPanels([]); } }}
                className="text-muted hover:text-white transition-colors text-xl font-mono"
              >
                ×
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              {storyboardModalMode === "choose" ? (
                <div className="grid grid-cols-1 gap-6">
                   <div className="space-y-2">
                    <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Storyboard Mode</span>
                    <p className="text-[12px] text-white/50 leading-relaxed uppercase tracking-widest">Choose how you want to build the storyboard.</p>
                  </div>
                  <button onClick={() => void handleGenerateStoryboardWithMode("ai")} disabled={storyboardModalSubmitting} className="btn btn-secondary !justify-start px-6 py-6 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                    <div className="text-left space-y-1">
                      <div className="text-[11px] font-mono text-accent-2 uppercase tracking-widest font-bold">AI Storyboard</div>
                      <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Generate storyboard frames automatically.</div>
                    </div>
                  </button>
                  <button onClick={() => void openManualStoryboardBuilder()} disabled={storyboardModalSubmitting} className="btn btn-secondary !justify-start px-6 py-6 h-auto group bg-panel border-line/10 hover:border-accent/30 transition-all">
                    <div className="text-left space-y-1">
                      <div className="text-[11px] font-mono text-white/70 uppercase tracking-widest font-bold">Manual Storyboard</div>
                      <div className="text-[9px] text-muted uppercase tracking-widest opacity-40">Build storyboard frames and beat mapping by hand.</div>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Manual Storyboard</span>
                    <p className="text-[12px] text-white/50 leading-relaxed uppercase tracking-widest">Synchronize visual metadata with temporal markers.</p>
                  </div>
                  <div className="space-y-6">
                    {manualStoryboardPanels.map((panel, index) => (
                      <div key={`manual-panel-${index}`} className="rounded-card border border-line bg-panel overflow-hidden divide-y divide-line/10">
                        <div className="px-5 py-3 bg-panel flex items-center justify-between">
                          <span className="text-[10px] font-mono text-accent font-bold uppercase tracking-widest">{panel.beatLabel}</span>
                          <span className="text-[9px] font-mono text-muted opacity-40 uppercase tracking-widest">[{panel.startTime}s - {panel.endTime}s]</span>
                        </div>
                        <div className="p-6 space-y-5">
                          <div className="space-y-2">
                             <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em] opacity-40">Voiceover</span>
                             <div className="bg-panel p-3 rounded-card text-[11px] font-mono text-muted leading-relaxed line-clamp-2 italic">&quot;{panel.vo}&quot;</div>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                             <div className="space-y-2">
                               <span className="text-[8px] font-mono text-accent-2/60 uppercase tracking-[0.2em]">Visual Direction</span>
                               <textarea
                                 value={panel.visualDescription}
                                 onChange={(e) => updateManualStoryboardPanel(index, "visualDescription", e.target.value)}
                                 className="w-full bg-panel border border-line/20 rounded-card p-3 text-[11px] font-mono text-white/70 min-h-[80px]"
                                 placeholder="Describe the shot..."
                               />
                             </div>
                             <div className="grid grid-cols-2 gap-4">
                               <div className="space-y-2">
                                  <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em]">Creator Action</span>
                                  <input
                                    value={panel.creatorAction}
                                    onChange={(e) => updateManualStoryboardPanel(index, "creatorAction", e.target.value)}
                                    className="w-full bg-panel border border-line/20 rounded-card px-3 py-2 text-[10px] font-mono text-white/70"
                                  />
                               </div>
                               <div className="space-y-2">
                                  <span className="text-[8px] font-mono text-muted uppercase tracking-[0.2em]">Text Overlay</span>
                                  <input
                                    value={panel.textOverlay}
                                    onChange={(e) => updateManualStoryboardPanel(index, "textOverlay", e.target.value)}
                                    className="w-full bg-panel border border-line/20 rounded-card px-3 py-2 text-[10px] font-mono text-white/70"
                                  />
                               </div>
                             </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="px-8 py-6 bg-panel border-t border-line/10 flex items-center justify-between">
              <button
                onClick={() => {
                  if (storyboardModalSubmitting) return;
                  if (storyboardModalMode === "choose") { setShowStoryboardModal(false); }
                  else { setStoryboardModalMode("choose"); }
                }}
                className="btn btn-secondary !min-h-[40px] px-8 text-[10px] uppercase font-bold tracking-widest"
              >
                {storyboardModalMode === "choose" ? "Cancel" : "Back"}
              </button>
              <button
                onClick={() => void handleGenerateStoryboardWithMode(storyboardModalMode === "choose" ? "ai" : "manual", manualStoryboardPanels)}
                disabled={storyboardModalSubmitting}
                className={`btn !min-h-[40px] px-10 text-[10px] uppercase font-bold tracking-widest ${storyboardModalMode === "choose" ? 'btn-primary' : 'btn-primary'}`}
              >
                {storyboardModalSubmitting ? "Generating..." : storyboardModalMode === "choose" ? "Generate Storyboard" : "Save Storyboard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMissingProductImageWarning && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-overlay backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-bg border border-danger/30 rounded-card overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="px-6 py-4 bg-danger/5 border-b border-danger/10">
              <span className="text-[11px] font-mono text-danger font-bold uppercase tracking-widest">Warning: Product image missing</span>
            </div>
            <div className="p-8 space-y-6">
              <p className="text-[13px] text-white/70 leading-relaxed font-mono uppercase tracking-tight">
                No product reference image found. Your generated ads may look worse without one.
              </p>
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => { setShowMissingProductImageWarning(false); setPendingVideoStep(null); void router.push(`/projects/${projectId}/products`); }}
                  className="btn btn-primary !min-h-[44px] text-[10px] uppercase font-bold tracking-widest"
                >
                  Go To Product Assets
                </button>
                <button
                  onClick={() => { const step = pendingVideoStep; setShowMissingProductImageWarning(false); setPendingVideoStep(null); if (step) { void runStep(step); } }}
                  className="btn btn-secondary border-danger/20 hover:border-danger/40 !min-h-[44px] text-[10px] uppercase font-bold tracking-widest"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-8 py-10 max-w-[1400px] mx-auto space-y-8">
        <section className="space-y-4">
          <div>
            <h2 className="app-section-title text-white">Research Hub</h2>
          </div>
          <div className="app-surface space-y-3">
            <p className="text-sm text-muted italic">
              Return to the research workspace to inspect customer insight, ad analysis, and supporting inputs.
            </p>
            <div className="flex items-center justify-between gap-4">
              <p className="app-status-line">
                Open Research Hub to review the inputs for this ad.
              </p>
              <Link
                href={
                  selectedProductId
                    ? `/projects/${projectId}/research-hub?productId=${selectedProductId}`
                    : `/projects/${projectId}/research-hub`
                }
                className="app-button app-button--primary text-sm font-medium"
              >
                Open Research Hub
              </Link>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="app-section-title text-white">Usage and Cost</h2>
          </div>
          <div className="app-surface space-y-3">
            <p className="text-sm text-muted italic">
              Review spend, usage events, and settled provider costs for this project.
            </p>
            <div className="flex items-center justify-between gap-4">
              <p className="app-status-line">
                Check spend and usage while building ads.
              </p>
              <Link
                href={`/projects/${projectId}/usage`}
                className="app-button app-button--primary text-sm font-medium"
              >
                Open Usage & Costs
              </Link>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-16 pt-12 border-t border-line/10 space-y-8 pb-12">
        <div className="flex items-center justify-between gap-4 px-2">
           <div className="flex items-center gap-4">
             <span className="text-[11px] font-mono text-accent font-bold uppercase tracking-widest shrink-0">Recent Jobs</span>
             <div className="h-[1px] w-32 bg-line/20 hidden md:block" />
             <span className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-40">Job History</span>
           </div>
           <Link
             href={`/projects/${projectId}/research-hub`}
             className="btn btn-secondary !min-h-[32px] px-6 text-[9px] uppercase font-bold tracking-widest text-accent border-accent/20 bg-accent/5 hover:bg-accent/10 transition-colors"
           >
             Back To Research Hub
           </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {recentCreativeJobs.map((job) => (
            <div key={job.id} className="rounded-card border border-line bg-panel p-5 flex flex-col justify-between gap-6 hover:border-accent/30 transition-all group">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="text-[12px] font-mono text-white font-bold uppercase tracking-wide group-hover:text-accent transition-colors">{getRunJobName(job)}</div>
                    <div className="text-[9px] font-mono text-muted uppercase tracking-widest opacity-60">
                      {new Date(job.updatedAt ?? job.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className={`status-chip !px-3 !py-1 text-[8px] font-bold uppercase tracking-widest ${
                    job.status === JobStatus.COMPLETED ? 'bg-accent/10 text-accent border-accent/20' :
                    job.status === JobStatus.FAILED ? 'bg-danger/10 text-danger border-danger/20' :
                    'bg-accent-2/10 text-accent-2 border-accent-2/20 animate-pulse'
                  }`}>
                    {job.status}
                  </div>
                </div>
                <div className="text-[9px] font-mono text-muted/40 uppercase tracking-widest truncate">Job ID: {job.id}</div>
              </div>
              
              {isCancelableJob(job) && (
                <button
                  onClick={() => void cancelJob(job.id)}
                  disabled={Boolean(cancellingJobIds[job.id])}
                  className="btn btn-danger w-full !min-h-[28px] text-[8px] uppercase font-bold tracking-widest"
                >
                  {cancellingJobIds[job.id] ? "Canceling..." : "Cancel Job"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {characterPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.8)" }}
            onClick={() => setCharacterPreview(null)}
          >
            <div
              className="w-full max-w-[360px] rounded-card border border-line bg-bg p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-medium text-white">{characterPreview.name}</p>
                <button
                  type="button"
                  onClick={() => setCharacterPreview(null)}
                  className="btn btn-secondary !min-h-[28px] px-3 text-[10px] font-bold uppercase tracking-widest"
                >
                  Close
                </button>
              </div>
              <img
                src={characterPreview.url}
                alt={`${characterPreview.name} preview`}
                className="block max-h-[80vh] max-w-full w-auto mx-auto rounded-card border border-line object-contain"
              />
            </div>
          </div>,
          document.body,
        )}

      <Toaster position="bottom-right" />
    </div>
  </div>
);
}
