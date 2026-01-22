import { cfg } from "@/lib/config";

export type RuntimeMode = "alpha" | "beta" | "prod";

export const RUNTIME_MODE = cfg.RUNTIME_MODE as RuntimeMode;

if (!RUNTIME_MODE) {
  throw new Error("RUNTIME_MODE must be set");
}

if (RUNTIME_MODE !== "alpha") {
  throw new Error(`Invalid runtime mode for alpha: ${RUNTIME_MODE}`);
}
