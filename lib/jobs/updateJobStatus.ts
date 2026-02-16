import { prisma } from "@/lib/prisma";
import { JobStatus, Prisma } from "@prisma/client";
import { assertValidTransition, isTerminalStatus } from "@/lib/jobStateMachine";

export async function updateJobStatus(
  jobId: string,
  nextStatus: JobStatus,
  extraData?: Prisma.JobUpdateInput
) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!job) {
      throw new Error("Job not found");
    }

    if (isTerminalStatus(job.status)) {
      throw new Error(`Job ${jobId} is in terminal state: ${job.status}`);
    }

    assertValidTransition(job.status, nextStatus);

    return tx.job.update({
      where: { id: jobId },
      data: { status: nextStatus, ...(extraData ?? {}) },
    });
  });
}
