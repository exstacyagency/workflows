import { prisma } from "@/lib/prisma";
import { JobStatus, type Job } from "@prisma/client";
import { ResearchArtifacts as ResearchStepArtifacts } from "./contracts/research";
import { runPatternBrain } from "./patternBrain/executor";
import { ResearchArtifacts as PatternBrainResearchArtifacts } from "./patternBrain/types";
import { runResearch } from "./steps/research";
import { PipelineStep } from "./types";
import { ALPHA_ENABLED_STAGES } from "./alphaStages";

type JobPayload = {
  forceFailStep?: PipelineStep;
};

async function assertJobRunning(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  if (!job || job.status !== JobStatus.RUNNING) {
    throw new Error("Job is no longer running");
  }
}

async function setStep(jobId: string, step: PipelineStep) {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: { currentStep: step },
  });

  if (updated.count === 0) {
    throw new Error("Job is no longer running");
  }
}

async function markRunning(jobId: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING },
  });
}

async function failJob(jobId: string, step: PipelineStep, err: Error) {
  await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.FAILED,
      currentStep: step,
      error: err.message,
    },
  });
}

async function maybeFail(payload: JobPayload, step: PipelineStep) {
  if (payload.forceFailStep === step) {
    throw new Error(`Forced failure at step: ${step}`);
  }
}

export async function executePipeline(job: Job) {
  const payload = (job.payload ?? {}) as JobPayload;
  const artifacts: Record<string, unknown> = {};

  try {
    await markRunning(job.id);

    await assertJobRunning(job.id);
    await setStep(job.id, "research");
    await maybeFail(payload, "research");
    artifacts.research = await runStep("research", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "pattern_brain");
    await maybeFail(payload, "pattern_brain");
    artifacts.pattern_brain = await runStep("pattern_brain", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "character");
    await maybeFail(payload, "character");
    artifacts.character = await runStep("character", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "script");
    await maybeFail(payload, "script");
    artifacts.script = await runStep("script", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "video_prompts");
    await maybeFail(payload, "video_prompts");
    artifacts.video_prompts = await runStep("video_prompts", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "storyboard");
    await maybeFail(payload, "storyboard");
    artifacts.storyboard = await runStep("storyboard", job, artifacts);

    await assertJobRunning(job.id);
    await setStep(job.id, "final");

    await prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.RUNNING },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: {
          steps: [
            "research",
            "pattern_brain",
            "character",
            "script",
            "video_prompts",
            "storyboard",
            "final",
          ],
        },
      },
    });
  } catch (err) {
    await failJob(
      job.id,
      (job.currentStep as PipelineStep) ?? "pattern_brain",
      err as Error,
    );
  }
}

/**
 * Internal-only step dispatcher.
 * MUST NOT be exported or reachable via HTTP.
 */
async function runStep(
  step: PipelineStep,
  job: { id: string; projectId: string; payload: unknown },
  artifacts: Record<string, unknown>,
) {
  if (!ALPHA_ENABLED_STAGES.has(step)) {
    throw new Error(`Stage ${step} is disabled in alpha`);
  }

  switch (step) {
    case "research":
      return runResearch({
        jobId: job.id,
        projectId: job.projectId,
        payload: job.payload,
      });

    case "pattern_brain": {
      const research = artifacts.research as ResearchStepArtifacts | undefined;
      const mappedResearch = toPatternBrainResearch(research);
      return runPatternBrain(mappedResearch);
    }

    case "character":
      return runCharacterSelection(artifacts);

    case "script":
      return runScriptGeneration(artifacts);

    case "video_prompts":
      return runVideoPromptGeneration(artifacts);

    case "storyboard":
      return runStoryboardGeneration(artifacts);

    case "final":
      return runFinalOutput(artifacts);

    default:
      throw new Error(`Unhandled pipeline step: ${step}`);
  }
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

async function runCharacterSelection(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

async function runScriptGeneration(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

async function runVideoPromptGeneration(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

async function runStoryboardGeneration(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

async function runFinalOutput(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

