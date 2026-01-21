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

  await markRunning(ctx.jobId);

  artifacts.research = await runResearchStep(job, resultSummary);
  artifacts.patternBrain = await runPatternBrainStep(
    job,
    artifacts,
    resultSummary,
  );
  artifacts.character = await characterSelectionStep(ctx, artifacts);
  artifacts.script = await scriptGenerationStep(ctx, artifacts);
  artifacts.videoPrompts = await videoPromptStep(ctx, artifacts);
  artifacts.storyboard = await storyboardStep(ctx, artifacts);
  artifacts.editedVideo = await videoEditingStep(ctx, artifacts);
  artifacts.finalOutput = await finalPreviewStep(ctx, artifacts);

  await markCompleted(ctx.jobId, artifacts, resultSummary);

  return artifacts;
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
      currentStep: "research",
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
      currentStep: "patternBrain",
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

