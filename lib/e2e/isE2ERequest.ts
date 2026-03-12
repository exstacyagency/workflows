import { cfg } from "@/lib/config";
import { headers } from "next/headers";

export async function isE2ERequest(): Promise<boolean> {
  // Never allow in prod
  if (cfg.raw("NODE_ENV") === "production") {
    return false;
  }

  const expected = cfg.raw("E2E_RESET_KEY");
  if (!expected) return false;

  const h = await headers();
  return h.get("x-e2e-reset-key") === expected;
}
