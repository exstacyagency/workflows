import { cfg } from "@/lib/config";

export const runtime = "nodejs";

const FORBIDDEN_PREFIXES = [
  "/api/e2e/",
  "/api/debug/",
];

export async function register() {
  // Edge runtimes cannot access node built-ins; skip instrumentation there
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // Build-time checks enforce forbidden routes; runtime hook is intentionally a no-op
  if (cfg.env !== "production") return;
}
