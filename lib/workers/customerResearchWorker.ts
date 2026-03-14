// CUSTOMER_RESEARCH is handled exclusively by workers/jobRunner.ts.
// This legacy Bull worker is intentionally disabled so jobRunner.ts
// markCompleted remains the only path that can complete the job.
export {};
