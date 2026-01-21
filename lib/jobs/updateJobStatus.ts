import { prisma } from "@/lib/prisma";
import { JobStatus } from "@prisma/client";
import { assertValidTransition } from "@/lib/jobStateMachine";

export async function updateJobStatus(jobId: string, nextStatus: JobStatus) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!job) {
      throw new Error("Job not found");
    }

    assertValidTransition(job.status, nextStatus);

    return tx.job.update({
      where: { id: jobId },
      data: { status: nextStatus },
    });
  });
}
