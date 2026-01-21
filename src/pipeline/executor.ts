import { prisma } from "@/lib/prisma";
import { JobStatus } from "@prisma/client";
import { ResearchArtifacts as ResearchStepArtifacts } from "./contracts/research";
import { runPatternBrain } from "./patternBrain/executor";
import { ResearchArtifacts as PatternBrainResearchArtifacts } from "./patternBrain/types";
import { runResearch } from "./steps/research";

export type PipelineStep =
  | "research"
  | "patternBrain"
  | "character"
  | "script"
  | "videoPrompts"
  | "storyboard"
  | "editedVideo"
  | "finalOutput";

const PIPELINE_STEPS: PipelineStep[] = [
  "research",
  "patternBrain",
  "character",
  "script",
  "videoPrompts",
  "storyboard",
  "editedVideo",
  "finalOutput",
];

export async function executePipeline(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Mark job as RUNNING once, up front
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.RUNNING,
      updatedAt: new Date(),
    },
  });

  const artifacts: Record<string, unknown> = {};

  try {
    for (const step of PIPELINE_STEPS) {
      // 🔒 Authoritative step update (forward-only)
      await prisma.job.update({
        where: { id: jobId },
        data: {
          currentStep: step,
          updatedAt: new Date(),
        },
      });

      // Execute step in isolation
      const result = await runStep(step, job, artifacts);

      // Persist artifacts in-memory only (DB write at end)
      artifacts[step] = result;

      if (step === "patternBrain") {
        // Persist Pattern Brain output for visibility
        await prisma.job.update({
          where: { id: jobId },
          data: {
            resultSummary: JSON.stringify({
              patternBrain: result,
            }),
            updatedAt: new Date(),
          },
        });
      }
    }

    // ✅ All steps completed successfully
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        resultSummary: JSON.stringify({
          steps: PIPELINE_STEPS,
          completedAt: new Date().toISOString(),
          patternBrain: artifacts.patternBrain,
        }),
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    // ❌ Immediate, terminal failure
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error: err instanceof Error ? err.message : "Unknown pipeline failure",
        updatedAt: new Date(),
      },
    });

    // Re-throw so runner logs it
    throw err;
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
  switch (step) {
    case "research":
      return runResearch({
        jobId: job.id,
        projectId: job.projectId,
        payload: job.payload,
      });

    case "patternBrain": {
      const research = artifacts.research as ResearchStepArtifacts | undefined;
      const mappedResearch = toPatternBrainResearch(research);
      return runPatternBrain(mappedResearch);
    }

    case "character":
      return runCharacterSelection(artifacts);

    case "script":
      return runScriptGeneration(artifacts);

    case "videoPrompts":
      return runVideoPromptGeneration(artifacts);

    case "storyboard":
      return runStoryboardGeneration(artifacts);

    case "editedVideo":
      return runVideoEditing(artifacts);

    case "finalOutput":
      return runFinalOutput(artifacts);

    default:
      // Exhaustiveness guard
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

async function runVideoEditing(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

async function runFinalOutput(_artifacts: Record<string, unknown>) {
  return { stub: true };
}

