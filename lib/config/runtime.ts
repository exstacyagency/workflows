// lib/config/runtime.ts

/* eslint-disable no-restricted-properties */
function getEnv(key: string): string {
  return process.env[key] || "";
}
/* eslint-enable no-restricted-properties */

function requireEnv(key: string): string {
  const value = getEnv(key);
  if (value) return value;
  throw new Error(`${key} is required`);
}

const nodeEnv = getEnv("NODE_ENV") || "development";
const runtimeMode = getEnv("MODE") || "alpha";
const securitySweep = getEnv("SECURITY_SWEEP") === "1";
const isProd = nodeEnv === "production";
const isDev = nodeEnv === "development";
const isGolden = getEnv("GOLDEN_MODE") === "1" || getEnv("IS_GOLDEN") === "1";
const enableTestUsers = getEnv("ENABLE_TEST_USERS") === "true" || isDev;

export function getRuntimeConfig() {
  return {
    raw: getEnv,
    env: nodeEnv,
    mode: runtimeMode,
    MODE: runtimeMode,
    runtimeMode,
    RUNTIME_MODE: runtimeMode,
    nodeEnv,
    NODE_ENV: nodeEnv,
    isProd,
    isDev,
    isGolden,
    securitySweep,
    SECURITY_SWEEP: securitySweep,
    jwtSecret: requireEnv("JWT_SECRET"),
    authTestSecret: getEnv("AUTH_TEST_SECRET"),
    databaseUrl: getEnv("DATABASE_URL"),
    redisUrl: getEnv("REDIS_URL"),
    nextauthUrl: getEnv("NEXTAUTH_URL"),
  };
}

export const cfg = {
  raw: getEnv,
  env: nodeEnv,
  MODE: runtimeMode,
  runtimeMode,
  RUNTIME_MODE: runtimeMode,
  isProd,
  isDev,
  securitySweep,
  isGolden,
  JOB_IDEMPOTENCY_ENABLED: getEnv("JOB_IDEMPOTENCY_ENABLED") === "true",
  nodeEnv,
  mode: runtimeMode,
  authTestSecret: getEnv("AUTH_TEST_SECRET"),
  ENABLE_TEST_USERS: enableTestUsers,
  nextauthUrl: getEnv("NEXTAUTH_URL"),
};
