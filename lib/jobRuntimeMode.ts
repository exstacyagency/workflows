export type RuntimeMode = "alpha" | "beta";

export function assertRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNTIME_MODE ?? "beta";

  if (mode !== "alpha" && mode !== "beta") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }

  return mode;
}
import { cfg } from "@/lib/config";

export type RuntimeMode = "alpha" | "production";

export function getRuntimeMode(): RuntimeMode {
  const mode = cfg.raw("RUNTIME_MODE") ?? "alpha";
  if (mode !== "alpha" && mode !== "production") {
    throw new Error(`Invalid runtime mode: ${mode}`);
  }
  return mode;
}
