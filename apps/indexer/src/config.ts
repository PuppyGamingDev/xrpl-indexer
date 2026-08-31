import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";

loadEnv();

const list = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const optionalList = z
  .string()
  .optional()
  .transform((s) => (s ? list(s) : undefined));

export const config = defineConfig({
  ...baseEnvSchema,
  /**
   * Fallback endpoint list used for BOTH live sync and historical backfill when
   * the mode-specific lists below are not set.
   */
  XRPL_ENDPOINTS: z
    .string()
    .default("wss://xrplcluster.com,wss://s2.ripple.com")
    .transform(list),
  /**
   * Endpoints for the live `ledger` subscription + catch-up. A non-full-history
   * Clio node is ideal here (only needs recent ledgers). Falls back to
   * XRPL_ENDPOINTS when unset.
   */
  XRPL_SYNC_ENDPOINTS: optionalList,
  /**
   * Endpoints for historical range/gap backfill. Must serve old ledgers — a
   * full-history rippled/Clio (your own or a public one). Falls back to
   * XRPL_ENDPOINTS when unset.
   */
  XRPL_BACKFILL_ENDPOINTS: optionalList,
  INDEXER_START_LEDGER: z.string().default("current"),
  /**
   * Record a per-ledger `account_balance` row for EVERY account's native XRP
   * whenever it changes (fees included). This is the single largest disk
   * consumer — off by default. When off, only AMM/Vault pseudo-accounts keep
   * XRP-balance history (needed for pool reserve series). IOU/MPT balances and
   * all token/NFT metrics are unaffected either way.
   */
  INDEXER_TRACK_XRP_BALANCES: z
    .string()
    .default("false")
    .transform((s) => s === "true" || s === "1"),
  INDEXER_BACKFILL_FLOOR: z.coerce.number().int().nonnegative().default(0),
  INDEXER_METRICS_PORT: z.coerce.number().int().positive().default(9101),
  /** Max ledgers to fetch concurrently during backfill. */
  INDEXER_BACKFILL_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type IndexerConfig = typeof config;

/** Endpoints for live subscription + catch-up (mode-specific list, else the shared one). */
export const syncEndpoints: string[] = config.XRPL_SYNC_ENDPOINTS ?? config.XRPL_ENDPOINTS;

/** Endpoints for historical backfill (mode-specific list, else the shared one). */
export const backfillEndpoints: string[] = config.XRPL_BACKFILL_ENDPOINTS ?? config.XRPL_ENDPOINTS;
