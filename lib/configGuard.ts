export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function requireEnv(names: string[], scope: string) {
  const missing = names.filter(
    (n) => !process.env[n] || String(process.env[n]).trim() === ""
  );
  if (missing.length > 0) {
    // This exact phrasing is important: jobRuntime treats it as permanent.
    throw new ConfigError(`${scope}: ${missing.join(", ")} must be set in .env`);
  }
}

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

