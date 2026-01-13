import { cfg } from "@/lib/config";

export function isDev(): boolean {
  return cfg.raw("NODE_ENV") !== "production";
}

export const JOB_IDEMPOTENCY_ENABLED = cfg.JOB_IDEMPOTENCY_ENABLED;
