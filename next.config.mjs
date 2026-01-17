/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push("bcryptjs", "fs", "path");
    }
    return config;
  },
  async rewrites() {
    const isProd = process.env.NODE_ENV === "production";
    const sweep = process.env.SECURITY_SWEEP === "1";

    // Only enable dev/debug rewrites in non-prod or golden (SECURITY_SWEEP) runs.
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
