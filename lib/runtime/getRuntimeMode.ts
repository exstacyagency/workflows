import { cfg } from "@/lib/config";

export type RuntimeMode = "dev" | "beta" | "prod";

export function getRuntimeMode(): RuntimeMode {
  const nodeEnv = cfg.raw("NODE_ENV");
  const explicitMode = cfg.raw("MODE");

  // Production runtime must NEVER be dev
  if (nodeEnv === "production") {
    if (explicitMode === "prod" || explicitMode === "beta") {
      return explicitMode as RuntimeMode;
    }
    // hard default for prod runtime
    return "beta";
  }

  // Non-production
  return explicitMode === "prod" || explicitMode === "beta"
    ? explicitMode as RuntimeMode
    : "dev";
}
