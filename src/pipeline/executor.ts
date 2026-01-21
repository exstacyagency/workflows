import { prisma } from "@/lib/prisma";
import { JobStatus } from "@prisma/client";
import { advanceJobState } from "@/src/jobs/advanceJobState";

type PipelineContext = {
  job: any;
  payload?: any;
  result?: any;
  summary?: string;
};

type PipelineStep = (ctx: PipelineContext) => Promise<PipelineContext>;

type PipelineDefinition = {
  steps: PipelineStep[];
};

async function stepValidateInput(ctx: PipelineContext): Promise<PipelineContext> {
  const payload = ctx.job?.payload;
  if (!payload) {
    throw new Error("Missing payload");
  }
  return { ...ctx, payload };
}

async function stepGenerateVideo(ctx: PipelineContext): Promise<PipelineContext> {
  return {
    ...ctx,
    result: {
      videoUrl: "https://example.com/fake-video.mp4",
    },
  };
}

async function stepFinalize(ctx: PipelineContext): Promise<PipelineContext> {
  return {
    ...ctx,
    summary: "Video generated successfully",
  };
}

const PIPELINES: Record<string, PipelineDefinition> = {
  VIDEO_GENERATION: {
    steps: [stepValidateInput, stepGenerateVideo, stepFinalize],
  },
};

export async function executeJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });

  if (!job) throw new Error("Job not found");
  if (job.status !== JobStatus.PENDING) {
    throw new Error(`Job not runnable from status ${job.status}`);
  }

  const pipeline = PIPELINES[job.type];
  if (!pipeline) {
    throw new Error(`Unknown pipeline: ${job.type}`);
  }

  await advanceJobState(job.id, JobStatus.RUNNING, { currentStep: "init" });

  let context: PipelineContext = { job };
  let lastStepName: string | null = "init";

  try {
    for (const step of pipeline.steps) {
      const stepName = step.name || "step";
      lastStepName = stepName;
      await prisma.job.update({ where: { id: job.id }, data: { currentStep: stepName } });
      context = await step(context);
    }

    const summary = context.summary ?? "Pipeline completed";
    await prisma.job.update({
      where: { id: job.id },
      data: { currentStep: null, resultSummary: summary },
    });
    await advanceJobState(job.id, JobStatus.COMPLETED, { currentStep: null, error: null });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await advanceJobState(job.id, JobStatus.FAILED, { currentStep: lastStepName, error: message });
  }
}

