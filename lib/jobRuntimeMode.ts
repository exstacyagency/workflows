import { cfg } from "@/lib/config/runtime";

export type RuntimeMode = "alpha" | "beta";

export function assertRuntimeMode(): RuntimeMode {
  const mode = cfg.RUNTIME_MODE ?? "beta";
  if (mode !== "alpha" && mode !== "beta") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }
  return mode;
}
