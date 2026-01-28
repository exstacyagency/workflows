import crypto from "node:crypto";

/** @type {import('next').NextConfig} */
const BUILD_ID =
  process.env.BUILD_ID ??
  crypto.randomBytes(8).toString("hex");

const nextConfig = {
  generateBuildId: async () => BUILD_ID,
  webpack: (config, { dev }) => {
    if (dev || process.env.NODE_ENV === "test") {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
