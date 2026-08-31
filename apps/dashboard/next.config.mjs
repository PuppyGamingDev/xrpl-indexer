import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // workspace packages are TS source — let Next transpile them
  transpilePackages: ["@xrpl-indexer/db", "@xrpl-indexer/core"],
  serverExternalPackages: ["postgres", "@node-rs/argon2"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
