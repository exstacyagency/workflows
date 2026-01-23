import { cfg } from "@/lib/config";

export function isDev(): boolean {
  return cfg.raw("NODE_ENV") !== "production";
}

export const JOB_IDEMPOTENCY_ENABLED = cfg.JOB_IDEMPOTENCY_ENABLED;

export const MODE = cfg.MODE;

if (cfg.env === 'production' && cfg.MODE !== 'beta') {
  throw new Error('Production build must run in MODE=beta');
}
