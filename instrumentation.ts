import { cfg } from "@/lib/config";

export const runtime = "nodejs";

const FORBIDDEN_PREFIXES = [
  "/api/e2e/",
  "/api/debug/",
];

export async function register() {
  // SECURITY_SWEEP is forbidden ONLY in real production; golden/e2e allowed
  if (cfg.isProd && !cfg.isGolden && cfg.securitySweep) {
    throw new Error("SECURITY_SWEEP must not be enabled in real production");
  }

  // Edge runtimes cannot access node built-ins; skip instrumentation there
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // Build-time checks already enforce forbidden routes; runtime hook is intentionally minimal
  if (cfg.env !== "production") return;
}
