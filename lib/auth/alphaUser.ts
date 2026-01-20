import { cfg } from "@/lib/config";

export const ALPHA_USER_EMAIL = "test@local.dev";

export function isAlphaAuthBypass() {
  return cfg.raw("MODE") === "alpha" || cfg.raw("NODE_ENV") === "development";
}
