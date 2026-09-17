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
    const webModules = path.join(here, "node_modules");
    const rootModules = path.join(repoRoot, "node_modules");
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    // Vercel Root Directory = web: only web/node_modules exists. Local
    // web:verify can still see the repo-root install.
    config.resolve.modules = [webModules, rootModules, ...(config.resolve.modules ?? ["node_modules"])];
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      zod: path.join(webModules, "zod"),
      "@runloop/api-client": path.join(webModules, "@runloop/api-client"),
    };
    return config;
  },
};

export default nextConfig;
