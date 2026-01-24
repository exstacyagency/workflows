import { cfg } from "@/lib/config";

export function isDev(): boolean {
  return cfg.raw("NODE_ENV") !== "production";
}

export const JOB_IDEMPOTENCY_ENABLED = cfg.JOB_IDEMPOTENCY_ENABLED;

export const MODE = cfg.MODE;

// Only crash if production mode is not one of the allowed values
if (cfg.env === 'production' && !['beta', 'prod'].includes(String(cfg.MODE))) {
  throw new Error('Production build must run in MODE=beta or MODE=prod');
}
