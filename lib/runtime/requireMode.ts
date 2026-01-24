// lib/runtime/requireMode.ts
import { cfg } from "@/lib/config";

export function requireRuntimeMode() {
  if (cfg.nodeEnv !== "production") return;

  const mode = cfg.mode;

  if (!mode) {
    throw new Error("MODE must be explicitly set in production");
  }

  if (mode !== "beta" && mode !== "prod") {
    throw new Error("Production build must run in MODE=beta or MODE=prod");
  }
}
