import { z } from "@xrpl-indexer/core/config";
import type { EnrichConfig } from "./context.ts";

/** Env schema shared by apps/worker and apps/backfiller. Spread into their config. */
export const enrichEnvSchema = {
  METADATA_GATEWAYS: z
    .string()
    .default("https://ipfs.io,https://cloudflare-ipfs.com,https://gateway.pinata.cloud")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  ARWEAVE_GATEWAY: z.string().default("https://arweave.net"),
  /** Global cap on IPFS/Arweave gateway requests/minute across the process (0 = off). */
  METADATA_IPFS_RPM: z.coerce.number().int().nonnegative().default(120),
  BITHOMP_API_KEY: z.string().optional(),
  BITHOMP_BASE_URL: z.string().default("https://bithomp.com/api/v2"),
  BITHOMP_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(300),
  XRPLTO_BASE_URL: z.string().default("https://api.xrpl.to/api"),
  XRPLMETA_BASE_URL: z.string().default("https://s1.xrplmeta.org"),
  XRPLMETA_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(240),
};

export function toEnrichConfig(c: {
  METADATA_GATEWAYS: string[];
  ARWEAVE_GATEWAY: string;
  METADATA_IPFS_RPM: number;
  BITHOMP_API_KEY?: string;
  BITHOMP_BASE_URL: string;
  BITHOMP_REQUESTS_PER_MINUTE: number;
  XRPLTO_BASE_URL: string;
  XRPLMETA_BASE_URL: string;
  XRPLMETA_REQUESTS_PER_MINUTE: number;
}): EnrichConfig {
  return {
    ipfsGateways: c.METADATA_GATEWAYS,
    arweaveGateway: c.ARWEAVE_GATEWAY,
    metadataIpfsRpm: c.METADATA_IPFS_RPM,
    bithompApiKey: c.BITHOMP_API_KEY || undefined,
    bithompBaseUrl: c.BITHOMP_BASE_URL,
    bithompRequestsPerMinute: c.BITHOMP_REQUESTS_PER_MINUTE,
    xrplToBaseUrl: c.XRPLTO_BASE_URL,
    xrplMetaBaseUrl: c.XRPLMETA_BASE_URL,
    xrplMetaRequestsPerMinute: c.XRPLMETA_REQUESTS_PER_MINUTE,
  };
}
