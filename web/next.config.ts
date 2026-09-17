import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  serverExternalPackages: ["@runloop/api-client", "pg", "@workos-inc/node", "stripe"],
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.join(repoRoot, "node_modules"),
    ];
    return config;
  },
};

export default nextConfig;
