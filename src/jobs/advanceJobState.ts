import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertValidTransition, isTerminalStatus } from "@/lib/jobStateMachine";

interface AdvanceOptions {
  currentStep?: string | null;
  error?: string | null;
}

export async function advanceJobState(jobId: string, nextStatus: JobStatus, opts?: AdvanceOptions) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { status: true, currentStep: true, error: true },
    });

    if (!job) {
      throw new Error("Job not found");
    }

    if (isTerminalStatus(job.status)) {
      throw new Error(`Job ${jobId} is in terminal state: ${job.status}`);
    }

    assertValidTransition(job.status, nextStatus);

    const data: Record<string, any> = { status: nextStatus };

    if (opts && "currentStep" in opts) {
      data.currentStep = opts.currentStep ?? null;
    }

    if (opts && "error" in opts) {
      data.error = opts.error ?? null;
    }

    return tx.job.update({
      where: { id: jobId },
      data,
    });
  });
}
