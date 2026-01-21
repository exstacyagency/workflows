import { JobStatus } from "@prisma/client";

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export function assertValidTransition(from: JobStatus, to: JobStatus) {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid job state transition: ${from} → ${to}`);
  }
}
