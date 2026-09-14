import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ticket-agent/contracts"],
  poweredByHeader: false
};

export default nextConfig;
