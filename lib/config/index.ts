/* eslint-disable no-restricted-properties */

const nodeEnv = process.env.NODE_ENV ?? "development";
const runtimeMode = process.env.MODE;
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
  MODE: runtimeMode,
  runtimeMode,
  RUNTIME_MODE: runtimeMode,
  securitySweep,
  isGolden: securitySweep,
  JOB_IDEMPOTENCY_ENABLED: process.env.JOB_IDEMPOTENCY_ENABLED === "true",
};

// Hard safety: SECURITY_SWEEP must never be enabled in production.
// CI often runs with NODE_ENV=production; allow sweep in CI only.
const isProd = nodeEnv === "production";
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";

if (!isNextBuild && isProd && !isCI && securitySweep) {
  throw new Error("SECURITY_SWEEP must not be enabled in production");
}
