import { cfg } from "@/lib/config";
import { CURRENT_RUNTIME_MODE, IS_ALPHA } from "./config/runtime";

export const runtime = "nodejs";

const MODE = CURRENT_RUNTIME_MODE;

const FORBIDDEN_PREFIXES = [
  "/api/e2e/",
  "/api/debug/",
];

export function register() {
  if (!MODE) {
    throw new Error("RUNTIME MODE MISSING");
  }

  if (IS_ALPHA) {
    console.log("[alpha] instrumentation enabled");
  }

  console.log(`[BOOT] Runtime mode: ${MODE}`);
  if (MODE === "alpha") {
    console.log("[PIPELINE] Running in ALPHA mode");
  }
  if (MODE === "alpha" && process.env.NODE_ENV === "production") {
    throw new Error("INVALID CONFIG: MODE=alpha cannot run with NODE_ENV=production");
  }

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
