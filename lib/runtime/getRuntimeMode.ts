import { cfg } from "@/lib/config";

export function getRuntimeMode(): "alpha" | "dev" | "production" {
  return cfg.runtimeMode;
}
