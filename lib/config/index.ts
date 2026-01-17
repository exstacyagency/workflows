/* eslint-disable no-restricted-properties */

const nodeEnv = process.env.NODE_ENV ?? "development";
const securitySweep = process.env.SECURITY_SWEEP === "1";

export const cfg = {
  raw(name: string): string | undefined {
    switch (name) {
      case "NODE_ENV":
        return process.env.NODE_ENV;
      case "CI":
        return process.env.CI;
      case "GITHUB_ACTIONS":
        return process.env.GITHUB_ACTIONS;
      default:
        return process.env[name];
    }
  },
  env: nodeEnv,
  isProd: nodeEnv === "production",
  isDev: nodeEnv !== "production",
  securitySweep,
  isGolden: securitySweep,
  JOB_IDEMPOTENCY_ENABLED: process.env.JOB_IDEMPOTENCY_ENABLED === "true",
};
// Hard safety: SECURITY_SWEEP must never be enabled in production.
// CI often runs with NODE_ENV=production; allow sweep in CI only.
const isProd = cfg.raw("NODE_ENV") === "production";
const isCI = cfg.raw("CI") === "true" || cfg.raw("GITHUB_ACTIONS") === "true";
const isNextBuild = cfg.raw("NEXT_PHASE") === "phase-production-build";
const isEdgeRuntime = cfg.raw("NEXT_RUNTIME") === "edge";
// Heuristic: treat hosted deployments as real production; local prod (e.g., golden/e2e) is allowed
const isHostedProd = Boolean(
  cfg.raw("VERCEL") || cfg.raw("FLY_ALLOC_ID") || cfg.raw("RAILWAY_STATIC_URL") || cfg.raw("AWS_REGION")
);

if (!isNextBuild && isProd && !isCI && !isEdgeRuntime && isHostedProd && cfg.securitySweep) {
  throw new Error("SECURITY_SWEEP must not be enabled in production");
}
