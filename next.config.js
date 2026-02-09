import crypto from "node:crypto";

const MODE = process.env.MODE ?? "dev";
const BUILD_ID = process.env.BUILD_ID ?? crypto.randomBytes(8).toString("hex");

function getRuntimeMode() {
  const nodeEnv = process.env.NODE_ENV;
  const explicitMode = process.env.MODE;
  if (nodeEnv === "production") {
    if (explicitMode === "prod" || explicitMode === "beta") {
      return explicitMode;
    }
    return "beta";
  }
  return explicitMode === "prod" || explicitMode === "beta" ? explicitMode : "dev";
}

const runtimeMode = getRuntimeMode();
console.log(`[BOOT] Runtime mode: ${runtimeMode}`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { MODE },
  experimental: {
    instrumentationHook: true,
  },
  generateBuildId: async () => BUILD_ID,
  webpack: (config, { dev, isServer }) => {
    if (dev || process.env.NODE_ENV === "test") {
      config.cache = false;
    }
    if (isServer) {
      config.externals.push("bcryptjs", "fs", "path");
    }
    return config;
  },
  async rewrites() {
    const isProd = process.env.NODE_ENV === "production";
    const sweep = process.env.SECURITY_SWEEP === "1";

    if (isProd && !sweep) {
      return [];
    }

    return [
      {
        source: "/api/e2e/reset",
        destination: "/api/_dev/e2e/reset",
      },
      {
        source: "/api/debug/:path*",
        destination: "/api/_dev/debug/:path*",
      },
    ];
  },
};

export default nextConfig;
