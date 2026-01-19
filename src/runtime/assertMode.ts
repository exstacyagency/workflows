import { cfg } from "@/lib/config";
import { RUNTIME_MODE } from "@/config/runtime";

export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];

export function assertRuntimeMode(): RuntimeMode {
  // During Next.js build / static analysis, do not throw.
  if (typeof window === "undefined" && cfg.raw("NEXT_PHASE") === "phase-production-build") {
    return RUNTIME_MODE.prod;
  }

  const mode = cfg.MODE;

  if (!mode || !(mode in RUNTIME_MODE)) {
    throw new Error("RUNTIME MODE MISSING: Start the app with MODE=alpha | beta | prod");
  }

  return RUNTIME_MODE[mode as keyof typeof RUNTIME_MODE];
}
