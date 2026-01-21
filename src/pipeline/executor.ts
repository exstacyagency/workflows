import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PipelineArtifacts } from "./types";
import { runResearch } from "./steps/research";

export type PipelineContext = {
  jobId: string;
  projectId: string;
  input: unknown;
};

export async function executePipeline(
  ctx: PipelineContext,
): Promise<PipelineArtifacts> {
  const artifacts: PipelineArtifacts = {};

  await markRunning(ctx.jobId);

  artifacts.research = await runResearch();
  artifacts.patterns = await patternBrainStep(ctx, artifacts);
  artifacts.character = await characterSelectionStep(ctx, artifacts);
  artifacts.script = await scriptGenerationStep(ctx, artifacts);
  artifacts.videoPrompts = await videoPromptStep(ctx, artifacts);
  artifacts.storyboard = await storyboardStep(ctx, artifacts);
  artifacts.editedVideo = await videoEditingStep(ctx, artifacts);
  artifacts.finalOutput = await finalPreviewStep(ctx, artifacts);

  await markCompleted(ctx.jobId, artifacts);

  return artifacts;
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

async function markCompleted(jobId: string, artifacts: PipelineArtifacts) {
  const steps = Object.keys(artifacts);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      resultSummary: JSON.stringify({
        completedAt: new Date().toISOString(),
        steps,
        research: artifacts.research,
      }),
    },
  });
}

/* ─────────────────────────────
   Pipeline steps (STUBS)
───────────────────────────── */

async function researchStep(_ctx: PipelineContext) {
  return { stub: true };
}

async function patternBrainStep(
  _ctx: PipelineContext,
  _artifacts: PipelineArtifacts,
) {
  return { stub: true };
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

