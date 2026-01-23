import { cfg } from "@/lib/config";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function requireEnv(names: string[], scope: string) {
  const missing = names.filter((n) => {
    const v = cfg().raw(n);
    return !v || v.trim() === "";
  });
  if (missing.length > 0) {
    // This exact phrasing is important: jobRuntime treats it as permanent.
    throw new ConfigError(`${scope}: ${missing.join(", ")} must be set in .env`);
  }
}

export function env(name: string): string | undefined {
  const v = cfg().raw(name);
  return v && v.trim() ? v.trim() : undefined;
}
