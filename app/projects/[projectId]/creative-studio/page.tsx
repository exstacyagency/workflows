// app/projects/[projectId]/creative-studio/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { JobStatus, JobType } from "@prisma/client";

type Job = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  resultSummary?: string | null;
  error?: string | null;
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
  const projectId = params?.projectId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [researchQuality, setResearchQuality] = useState<ResearchQuality>({
    customer: false,
    product: false,
    ad: false,
    score: 0,
    message: "No research completed yet",
  });

  useEffect(() => {
    if (!projectId) return;
    loadJobs();
  }, [projectId]);

  async function loadJobs() {
    try {
      const res = await fetch(`/api/projects/${projectId}/jobs`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load jobs");
      const data = await res.json();
      const loadedJobs = data.jobs || [];
      setJobs(loadedJobs);
      
      // Calculate research quality
      const customer = loadedJobs.some(
        (j: Job) =>
          j.type === JobType.CUSTOMER_ANALYSIS && j.status === JobStatus.COMPLETED
      );
      const product = false; // Will enable when product research is implemented
      const ad = loadedJobs.some(
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
  }

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

    setSubmitting(step.key);
    setError(null);

    try {
      let endpoint = "";
      let payload: any = { projectId };

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
      await loadJobs();
    } catch (err: any) {
      setError(err.message);
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

  return (
    <div className="px-6 py-6 space-y-6 max-w-4xl">
      {/* Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Creative Studio</h1>
            <p className="text-sm text-slate-300 mt-1">
              Transform your research into high-quality video ads through our automated production pipeline.
            </p>
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
            onClick={() => router.push(`/projects/${projectId}/research-hub`)}
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
                      {step.lastJob && (
                        <p className="text-xs text-slate-400">
                          {step.lastJob.resultSummary || "Job completed"}
                        </p>
                      )}
                      {step.status === "failed" && step.lastJob?.error && (
                        <p className="text-xs text-red-400">{step.lastJob.error}</p>
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
                    className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors whitespace-nowrap"
                  >
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
    </div>
  );
}
