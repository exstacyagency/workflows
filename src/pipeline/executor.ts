import { Job, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ResearchArtifacts as ResearchStepArtifacts } from "./contracts/research";
import { PipelineArtifacts } from "./types";
import { runPatternBrain } from "./patternBrain/executor";
import {
  PatternBrainArtifacts,
  ResearchArtifacts as PatternBrainResearchArtifacts,
} from "./patternBrain/types";
import { runResearch } from "./steps/research";
import { FailureCode } from "./failureCodes";
import { ALPHA_ENABLED_STAGES } from "./alphaStages";

export type PipelineContext = {
  jobId: string;
  projectId: string;
  input: unknown;
};

export async function executePipeline(
  ctx: PipelineContext,
): Promise<PipelineArtifacts> {
  const job = await prisma.job.findUnique({ where: { id: ctx.jobId } });

  if (!job) {
    throw new Error(`Job ${ctx.jobId} not found`);
  }
  const artifacts: PipelineArtifacts = {};
  const resultSummary = parseResultSummary(job.resultSummary);

  try {
    if (job.runtimeMode !== "alpha") {
      throw new Error("Pipeline execution outside alpha mode is forbidden");
    }

    console.log("ALPHA DETERMINISM:", job.determinism);

    await markRunning(ctx.jobId);

    await setCurrentStep(ctx.jobId, "research");
    artifacts.research = await runStep("research", () =>
      runResearchStep(job, resultSummary),
    );
    await setCurrentStep(ctx.jobId, "pattern_brain");
    artifacts.patternBrain = await runStep("pattern_brain", () =>
      runPatternBrainStep(job, artifacts, resultSummary),
    );
    await setCurrentStep(ctx.jobId, "character");
    artifacts.character = await runStep("character", () =>
      characterSelectionStep(ctx, artifacts),
    );
    await setCurrentStep(ctx.jobId, "script");
    artifacts.script = await runStep("script", () =>
      scriptGenerationStep(ctx, artifacts),
    );
    await setCurrentStep(ctx.jobId, "video_prompts");
    artifacts.videoPrompts = await runStep("video_prompts", () =>
      videoPromptStep(ctx, artifacts),
    );
    await setCurrentStep(ctx.jobId, "storyboard");
    artifacts.storyboard = await runStep("storyboard", () =>
      storyboardStep(ctx, artifacts),
    );
    await setCurrentStep(ctx.jobId, "video_editing");
    artifacts.editedVideo = await runStep("video_editing", () =>
      videoEditingStep(ctx, artifacts),
    );
    await setCurrentStep(ctx.jobId, "final");
    artifacts.finalOutput = await runStep("final", () =>
      finalPreviewStep(ctx, artifacts),
    );

    await markCompleted(ctx.jobId, artifacts, resultSummary);

    return artifacts;
  } catch (err) {
    await failJob(
      job.id,
      job.currentStep ?? "unknown",
      FailureCode.INTEGRATION_FAILURE,
      err instanceof Error ? err.message : "Unknown error",
    );
    return artifacts;
  }
}

function parseResultSummary(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Swallow parse errors to avoid blocking job execution.
    return {} as Record<string, unknown>;
  }
}

/* ─────────────────────────────
   Internal helpers
───────────────────────────── */

async function markRunning(jobId: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING },
  });
}

async function setCurrentStep(jobId: string, step: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { currentStep: step },
  });
}

async function markCompleted(
  jobId: string,
  artifacts: PipelineArtifacts,
  resultSummary: Record<string, unknown>,
) {
  const steps = Object.keys(artifacts);
  const completedAt = new Date().toISOString();

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      resultSummary: JSON.stringify({
        ...resultSummary,
        ...artifacts,
        completedAt,
        steps,
      }),
    },
  });
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  if (!ALPHA_ENABLED_STAGES.has(step)) {
    throw new Error(`Stage ${step} is disabled in alpha`);
  }

  return fn();
}

async function failJob(
  jobId: string,
  step: string,
  code: FailureCode,
  message: string,
) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      currentStep: step,
      failureCode: code,
      error: { message },
    },
  });
}

/* ─────────────────────────────
   Pipeline steps (STUBS)
───────────────────────────── */

async function runResearchStep(
  job: Job,
  resultSummary: Record<string, unknown>,
) {
  const artifacts = await runResearch({
    jobId: job.id,
    projectId: job.projectId,
    payload: job.payload,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: {
      resultSummary: JSON.stringify({
        ...resultSummary,
        research: artifacts,
      }),
    },
  });

  resultSummary.research = artifacts;

  return artifacts;
}

async function runPatternBrainStep(
  job: Job,
  artifacts: PipelineArtifacts,
  resultSummary: Record<string, unknown>,
) {
  const patternBrainInput = toPatternBrainResearch(artifacts.research);
  const patterns = await runPatternBrain(patternBrainInput);

  await prisma.job.update({
    where: { id: job.id },
    data: {
      resultSummary: JSON.stringify({
        ...resultSummary,
        patternBrain: patterns,
      }),
    },
  });

  resultSummary.patternBrain = patterns;

  return patterns;
}

function toPatternBrainResearch(
  research: ResearchStepArtifacts | undefined,
): PatternBrainResearchArtifacts {
  if (!research) {
    return {
      customerInsights: [],
      productInsights: [],
      adInsights: [],
    };
  }

  const result: PatternBrainResearchArtifacts = {
    customerInsights: [],
    productInsights: [],
    adInsights: [],
  };

  for (const insight of research.insights ?? []) {
    const facts = insight.facts ?? [];

    if (insight.category === "customer") {
      result.customerInsights.push(...facts);
    } else if (insight.category === "product") {
      result.productInsights.push(...facts);
    } else if (insight.category === "ad") {
      result.adInsights.push(...facts);
    }
  }

  return result;
}

async function characterSelectionStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

async function scriptGenerationStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

async function videoPromptStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

async function storyboardStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

async function videoEditingStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

async function finalPreviewStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
}

