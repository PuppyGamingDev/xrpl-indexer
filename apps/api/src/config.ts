import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";

loadEnv();

export const config = defineConfig({
  ...baseEnvSchema,
  API_PORT: z.coerce.number().int().positive().default(4100),
  API_HOST: z.string().default("0.0.0.0"),
  API_RESPONSE_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(4000),
  API_HOLDERS_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(300_000),
  API_DEFAULT_IPFS_GATEWAY: z.string().default("https://ipfs.io"),
  API_DB_POOL: z.coerce.number().int().positive().default(20),
});
