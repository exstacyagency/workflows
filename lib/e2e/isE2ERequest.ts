import { cfg } from "@/lib/config";
import { headers } from "next/headers";

export function isE2ERequest(): boolean {
  // Never allow in prod
  if (cfg.raw("NODE_ENV") === "production") {
    return false;
  }

  const expected = cfg.raw("E2E_RESET_KEY");
  if (!expected) return false;

  const h = headers();
  return h.get("x-e2e-reset-key") === expected;
}