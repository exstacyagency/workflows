import { cfg } from "@/lib/config";
import { RUNTIME_MODE } from "@/config/runtime";
import type { RuntimeMode } from "./mode";

export function assertRuntimeMode(): RuntimeMode {
  /**
   * IMPORTANT:
   * - This function must be safe during Next build / static analysis
   * - Runtime enforcement happens at request-time only
   */

  // Build / type-check / static collection
  if (typeof window === "undefined" && cfg.raw("NEXT_PHASE")) {
    return (RUNTIME_MODE ?? "prod") as RuntimeMode;
  }

  if (!RUNTIME_MODE) {
    throw new Error(
      "RUNTIME MODE MISSING: Start the app with MODE=alpha | beta | prod"
    );
  }

  return RUNTIME_MODE as RuntimeMode;
}
