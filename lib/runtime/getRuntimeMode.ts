import { cfg } from "@/lib/config";

export function getRuntimeMode(): "alpha" | "dev" | "production" {
  const mode = cfg.runtimeMode;
  if (mode === "alpha" || mode === "dev" || mode === "production") {
    return mode;
  }
  return "dev";
}
