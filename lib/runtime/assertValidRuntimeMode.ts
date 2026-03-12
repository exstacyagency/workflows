import { env } from "@/lib/env";

/**
 * Runtime mode assertion that is SAFE across:
 * - next dev
 * - next start (prod build)
 * - node:test
 * - API route execution
 *
 * Fails closed in production if MODE is missing.
 */
export function assertValidRuntimeMode(): void {
  if (env.NODE_ENV === "production" && !env.MODE) {
    throw new Error("MODE must be explicitly set in production");
  }

  const resolvedMode =
    env.MODE ??
    (env.NODE_ENV === "test"
      ? "test"
      : "dev");

  if (
    resolvedMode !== "dev" &&
    resolvedMode !== "test" &&
    resolvedMode !== "beta" &&
    resolvedMode !== "prod"
  ) {
    throw new Error(`Invalid runtime mode: ${resolvedMode}`);
  }
}
