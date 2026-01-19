import { cfg } from "@/lib/config";
import { getRuntimeMode, RuntimeMode } from "./mode";

export function assertRuntimeMode(): RuntimeMode {
  // During Next.js build/static analysis, fall back to a safe default so type-checking passes.
  if (cfg.raw("NEXT_PHASE") === "phase-production-build") {
    return "prod";
  }

  return getRuntimeMode();
}
