

// Centralized config object for environment access

function getEnv(name: string): string | undefined {
  if (typeof globalThis !== "undefined" &&
      typeof globalThis.process !== "undefined" &&
      typeof globalThis.process.env !== "undefined") {
    return globalThis.process.env[name];
  }
  return undefined;
}

const nodeEnv = getEnv("NODE_ENV") ?? "development";
const runtimeMode = getEnv("MODE");
const securitySweep = getEnv("SECURITY_SWEEP") === "1";


export const cfg = {
  raw: getEnv,
  env: nodeEnv,
  MODE: runtimeMode,
  runtimeMode,
  RUNTIME_MODE: runtimeMode,
  isProd: nodeEnv === "production",
  isDev: nodeEnv !== "production",
  securitySweep,
  isGolden: securitySweep,
  JOB_IDEMPOTENCY_ENABLED: getEnv("JOB_IDEMPOTENCY_ENABLED") === "true",
  nodeEnv,
  mode: runtimeMode,
  authTestSecret: getEnv("AUTH_TEST_SECRET"),
};

const isProd = cfg.raw("NODE_ENV") === "production";
const isCI = cfg.raw("CI") === "true" || cfg.raw("GITHUB_ACTIONS") === "true";
const isNextBuild = cfg.raw("NEXT_PHASE") === "phase-production-build";
const isEdgeRuntime = cfg.raw("NEXT_RUNTIME") === "edge";
const isHostedProd = Boolean(
  cfg.raw("VERCEL") || cfg.raw("FLY_ALLOC_ID") || cfg.raw("RAILWAY_STATIC_URL") || cfg.raw("AWS_REGION")
);

if (!isNextBuild && isProd && !isCI && !isEdgeRuntime && isHostedProd && cfg.securitySweep) {
  throw new Error("SECURITY_SWEEP must not be enabled in production");
}
