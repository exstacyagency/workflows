import crypto from "node:crypto";

const MODE = process.env.MODE ?? "dev";
const BUILD_ID = process.env.BUILD_ID ?? crypto.randomBytes(8).toString("hex");
const APP_ORIGIN = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: APP_ORIGIN },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
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
