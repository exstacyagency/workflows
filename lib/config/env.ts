import { cfg } from "@/lib/config";

export type DeploymentMode = "saas" | "self_hosted";

export function parseDeploymentMode(raw?: string): DeploymentMode {
  const value = (raw ?? "").trim();
  if (!value) return "saas";
  if (value === "saas" || value === "self_hosted") return value;
  throw new Error(`Invalid DEPLOYMENT_MODE: ${raw}`);
}

export function getDeploymentMode(): DeploymentMode {
  return parseDeploymentMode(cfg.raw("DEPLOYMENT_MODE"));
}
