// lib/config/validateEnv.ts
export type EnvCheck = {
  name: string;
  requiredInProd?: boolean;
  requiredIf?: () => boolean; // optional conditional requirement
};

function isProd() {
  return process.env.NODE_ENV === "production";
}

function has(name: string) {
  const v = process.env[name];
  return !!(v && v.trim().length > 0);
}

const checks: EnvCheck[] = [
  { name: "DATABASE_URL", requiredInProd: true },
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

let validated = false;

export function validateEnvOnce() {
  if (validated) return;
  validated = true;

  const missing: string[] = [];

  for (const c of checks) {
    const needed =
      (c.requiredInProd && isProd()) ||
      (c.requiredIf ? c.requiredIf() : false);
    if (needed && !has(c.name)) missing.push(c.name);
  }

  if (missing.length > 0) {
    const msg = `Missing required environment variables: ${missing.join(", ")}`;
    // Fail hard in production
    if (isProd()) {
      throw new Error(msg);
    }
    // Dev: log warning
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
}

