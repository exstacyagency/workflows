import { cfg } from "@/lib/config";
import { z } from "zod";

export type AppConfig = {
  QUEUE_BACKEND: "db" | "redis";
  REDIS_URL?: string;
};

export const EnvSchema = z.object({
  QUEUE_BACKEND: z.enum(["db", "redis"]).default("db"),
  REDIS_URL: z.string().optional(),
});

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
