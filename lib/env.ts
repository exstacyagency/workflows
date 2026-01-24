import { cfg } from "@/lib/config";

export function isDev(): boolean {
  return cfg.raw("NODE_ENV") !== "production";
}

export const JOB_IDEMPOTENCY_ENABLED = cfg.JOB_IDEMPOTENCY_ENABLED;

export const MODE = cfg.MODE;

// Only enforce MODE check in production builds
if (cfg.raw('NODE_ENV') === 'production') {
  if (!['beta', 'prod'].includes(String(cfg.MODE))) {
    throw new Error('Production build must run in MODE=beta or MODE=prod');
  }
}
