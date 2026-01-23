import { cfg } from "./runtime";

const isProd = cfg().raw("NODE_ENV") === "production";

const PROD_DISABLED_FLAGS = new Set([
  "FF_DEV_TEST_MODE",
  "FF_BREAKER_TEST",
  "FF_FORCE_SCRIPT_FAIL",
  "FF_SIMULATE_LLM_FAIL",
  "FF_SIMULATE_LLM_HANG",
]);

const PROD_DISABLED_NUMBERS = new Set([
  "FF_WORKER_SLEEP_MS",
]);

export function flag(name: string): boolean {
  if (isProd && PROD_DISABLED_FLAGS.has(name)) return false;
  return String(cfg().raw(name) ?? "").toLowerCase() === "true";
}

export function devNumber(name: string, fallback = 0): number {
  if (isProd && PROD_DISABLED_NUMBERS.has(name)) return 0;
  const v = Number(cfg().raw(name));
  return Number.isFinite(v) ? v : fallback;
}

export function nodeEnv() {
  return cfg().raw("NODE_ENV") ?? "development";
}
