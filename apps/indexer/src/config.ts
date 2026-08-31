import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";

loadEnv();

export const config = defineConfig({
  ...baseEnvSchema,
  XRPL_ENDPOINTS: z
    .string()
    .default("wss://xrplcluster.com,wss://s2.ripple.com")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  INDEXER_START_LEDGER: z.string().default("current"),
  INDEXER_BACKFILL_FLOOR: z.coerce.number().int().nonnegative().default(0),
  INDEXER_METRICS_PORT: z.coerce.number().int().positive().default(9101),
  /** Max ledgers to fetch concurrently during backfill. */
  INDEXER_BACKFILL_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type IndexerConfig = typeof config;
