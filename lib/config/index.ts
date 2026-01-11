/* eslint-disable no-restricted-properties */

export const cfg = {
  raw(name: string): string | undefined {
    switch (name) {
      case "NODE_ENV":
        return process.env.NODE_ENV;
      case "CI":
        return process.env.CI;
      case "GITHUB_ACTIONS":
        return process.env.GITHUB_ACTIONS;
      default:
        return process.env[name];
    }
  },
};
// Hard safety: SECURITY_SWEEP must never be enabled in production.
// CI often runs with NODE_ENV=production; allow sweep in CI only.
const isProd = cfg.raw("NODE_ENV") === "production";
const isCI = cfg.raw("CI") === "true" || cfg.raw("GITHUB_ACTIONS") === "true";

if (isProd && !isCI && cfg.raw("SECURITY_SWEEP") === "1") {
  throw new Error("SECURITY_SWEEP must not be enabled in production");
}
