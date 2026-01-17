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
    if (process.env.NODE_ENV === "production") {
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
