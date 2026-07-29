import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@dse/api-client", "@dse/config", "@dse/shared", "@dse/ui"],
  async rewrites() {
    if (process.env.NODE_ENV !== "production") {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:3001/api/:path*",
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
