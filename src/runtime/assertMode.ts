import { cfg } from "@/lib/config";
import { RUNTIME_MODE, type RuntimeMode } from "@/config/runtime";

function isBuildTime(): boolean {
  return cfg.raw("NEXT_PHASE") === "phase-production-build";
}

export function assertRuntimeMode(): RuntimeMode {
  const mode = cfg.runtimeMode ?? cfg.MODE ?? null;

  if (!mode) {
    if (isBuildTime()) {
      return "alpha";
    }
    throw new Error("RUNTIME MODE MISSING: You must start the app with MODE=alpha | beta | prod");
  }

  if (!(RUNTIME_MODE as readonly string[]).includes(mode)) {
    if (mode === "alpha") return "alpha";
    throw new Error(`INVALID RUNTIME MODE: ${mode}`);
  }

  return mode as RuntimeMode;
}
