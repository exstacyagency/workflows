import { cfg } from "@/lib/config";
import { RUNTIME_MODE } from "@/config/runtime";

export type RuntimeMode = (typeof RUNTIME_MODE)[number];

export function assertRuntimeMode(): RuntimeMode {
  const mode = cfg.runtimeMode;

  if (!mode || !RUNTIME_MODE.includes(mode as RuntimeMode)) {
    throw new Error(
      `Invalid runtime mode: ${mode}. Expected one of ${RUNTIME_MODE.join(", ")}`
    );
  }

  return mode as RuntimeMode;
}
