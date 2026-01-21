import { JobStatus } from "@prisma/client";

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

const TERMINAL_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED];

export function isTerminalStatus(status: JobStatus) {
  return TERMINAL_STATUSES.includes(status);
}

export function assertValidTransition(from: JobStatus, to: JobStatus) {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}
