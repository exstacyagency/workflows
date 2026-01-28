import { env } from "@/lib/env";

/**
 * Runtime mode assertion that is SAFE across:
 * - next dev
 * - next start (prod build)
 * - node:test
 * - API route execution
 *
 * Never throws for missing MODE.
 */
export function assertValidRuntimeMode(): void {
  const resolvedMode =
    env.MODE ??
    (env.NODE_ENV === "test"
      ? "test"
      : env.NODE_ENV === "production"
      ? "beta"
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
