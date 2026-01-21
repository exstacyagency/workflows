import { prisma } from "@/lib/prisma";
import { JobStatus } from "@prisma/client";

const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: [JobStatus.RUNNING],
  RUNNING: [JobStatus.COMPLETED, JobStatus.FAILED],
  COMPLETED: [],
  FAILED: [],
};

function assertTransition(from: JobStatus, to: JobStatus) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}

export async function advanceJobState(jobId: string, nextState: JobStatus) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) throw new Error("Job not found");

  assertTransition(job.status, nextState);

  return prisma.job.update({
    where: { id: jobId },
    data: { status: nextState },
  });
}

export async function processJob(jobId: string) {
  await advanceJobState(jobId, JobStatus.RUNNING);

  // Temporary dev simulation
  await new Promise((r) => setTimeout(r, 500));

  await advanceJobState(jobId, JobStatus.COMPLETED);
}
