/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push("bcryptjs");
    }
    return config;
  },
};

export default nextConfig;
