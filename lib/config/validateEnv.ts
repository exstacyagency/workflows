/* eslint-disable no-restricted-properties */
// lib/config/validateEnv.ts
export type EnvCheck = {
  name: string;
  requiredInProd?: boolean;
  requiredIf?: () => boolean; // optional conditional requirement
};

type InvalidValueCheck = {
  name: string;
  validate: (value: string) => string | null;
};

function isProd() {
  return process.env.NODE_ENV === "production";
}

function isProductionBuildPhase() {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build"
  );
}

function shouldEnforceProdRuntimeChecks() {
  return isProd() && !isProductionBuildPhase();
}

function has(name: string) {
  const v = process.env[name];
  return !!(v && v.trim().length > 0);
}

const checks: EnvCheck[] = [
  { name: "DATABASE_URL", requiredInProd: true },
  { name: "APP_URL", requiredInProd: true },
  { name: "MODE", requiredInProd: true },
  { name: "NEXTAUTH_SECRET", requiredInProd: true },
  { name: "NEXTAUTH_URL", requiredInProd: true },

  // Media signing (only required if you intend to sign in prod)
  {
    name: "S3_MEDIA_BUCKET",
    requiredIf: () => isProd() && process.env.MEDIA_SIGNING_REQUIRED === "true",
  },
  {
    name: "S3_MEDIA_REGION",
    requiredIf: () => isProd() && process.env.MEDIA_SIGNING_REQUIRED === "true",
  },
  {
    name: "S3_ACCESS_KEY_ID",
    requiredIf: () => isProd() && process.env.MEDIA_SIGNING_REQUIRED === "true",
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    requiredIf: () => isProd() && process.env.MEDIA_SIGNING_REQUIRED === "true",
  },

  // Optional integrations (not required by default)
  // Redis, Apify, KIE can remain optional; they fail gracefully via ConfigError paths.
];

const exactUnsafeValues = new Set([
  "changeme",
  "change-me",
  "replace-me",
  "replace_me",
  "example",
  "example-key",
  "example-secret",
  "test",
  "test-key",
  "test-secret",
]);

function looksLikeDevSecret(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    exactUnsafeValues.has(normalized) ||
    normalized.startsWith("dev-") ||
    normalized.includes("change-before-prod") ||
    normalized.includes("local-only") ||
    normalized.includes("<") ||
    normalized.includes("your-")
  );
}

function looksLocalUrl(value: string) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value);
}

const invalidValueChecks: InvalidValueCheck[] = [
  {
    name: "MODE",
    validate: (value) =>
      ["alpha", "dev", "test"].includes(value.trim().toLowerCase())
        ? "must not use a dev/test runtime mode in production"
        : null,
  },
  {
    name: "APP_URL",
    validate: (value) =>
      looksLocalUrl(value) ? "must not point to localhost in production" : null,
  },
  {
    name: "NEXTAUTH_URL",
    validate: (value) =>
      looksLocalUrl(value) ? "must not point to localhost in production" : null,
  },
  {
    name: "NEXTAUTH_SECRET",
    validate: (value) =>
      looksLikeDevSecret(value) ? "looks like a dev/example secret" : null,
  },
  {
    name: "AUTH_SECRET",
    validate: (value) =>
      looksLikeDevSecret(value) ? "looks like a dev/example secret" : null,
  },
  {
    name: "DEBUG_ADMIN_TOKEN",
    validate: (value) =>
      looksLikeDevSecret(value) ? "looks like a dev/example admin token" : null,
  },
];

let validated = false;

export function validateEnvOnce() {
  if (validated) return;
  validated = true;

  const missing: string[] = [];
  const invalid: string[] = [];

  for (const c of checks) {
    const needed =
      (c.requiredInProd && shouldEnforceProdRuntimeChecks()) ||
      (c.requiredIf ? c.requiredIf() : false);
    if (needed && !has(c.name)) missing.push(c.name);
  }

  if (shouldEnforceProdRuntimeChecks()) {
    for (const check of invalidValueChecks) {
      if (!has(check.name)) continue;
      const reason = check.validate(process.env[check.name] ?? "");
      if (reason) invalid.push(`${check.name} ${reason}`);
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (invalid.length > 0) {
      parts.push(`Unsafe production environment values: ${invalid.join("; ")}`);
    }
    const msg = parts.join(" | ");
    // Fail hard in production
    if (shouldEnforceProdRuntimeChecks()) {
      throw new Error(msg);
    }
    // Dev: log warning
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
}
