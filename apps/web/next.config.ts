import type { NextConfig } from "next";

function normalizeCrossDriveEntry<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/^\.\/([A-Za-z]:\/)/, "$1") as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCrossDriveEntry(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeCrossDriveEntry(item)]),
    ) as T;
  }

  return value;
}

const nextConfig: NextConfig = {
  // Codex worktrees may live on a different Windows drive from their pnpm store.
  // Next's standalone trace copier cannot represent a second drive inside its output path.
  output: process.env.NEXT_DISABLE_STANDALONE === "true" ? undefined : "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@dse/api-client", "@dse/config", "@dse/shared", "@dse/ui"],
  webpack(config) {
    const originalEntry = config.entry;

    // pnpm dependencies can live on a different Windows drive in Codex worktrees.
    // Next prefixes those absolute client entries with "./", which webpack cannot resolve.
    if (typeof originalEntry === "function") {
      config.entry = async (...args: Parameters<typeof originalEntry>) =>
        normalizeCrossDriveEntry(await originalEntry(...args));
    } else {
      config.entry = normalizeCrossDriveEntry(originalEntry);
    }

    return config;
  },
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
