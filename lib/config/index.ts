/* eslint-disable no-restricted-properties */
export const cfg = {
  raw(name: string): string | undefined {
    switch (name) {
      case "NODE_ENV":
        return process.env.NODE_ENV;
      case "CI":
        return process.env.CI;
      default:
        return process.env[name];
    }
  },
};

// Hard safety: SECURITY_SWEEP must never be enabled in real production.
// CI often runs with NODE_ENV=production for reproducibility; allow sweep in CI only.
const isProd = process.env.NODE_ENV === "production";
const isCI =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true";
if (isProd && !isCI && process.env.SECURITY_SWEEP === "1") {
  throw new Error("SECURITY_SWEEP must not be enabled in production");
}
