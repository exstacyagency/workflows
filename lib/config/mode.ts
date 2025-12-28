import { cfg } from "@/lib/config";
import { parseDeploymentMode } from "@/lib/config/env";

export function isSelfHosted(): boolean {
  const mode = parseDeploymentMode(cfg.raw("DEPLOYMENT_MODE"));
  return mode === "self_hosted";
}
