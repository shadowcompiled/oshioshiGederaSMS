/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) config.externals = [...(config.externals || []), "better-sqlite3"];
    return config;
  },
};

module.exports = nextConfig;
