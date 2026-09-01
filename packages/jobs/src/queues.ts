/** Canonical queue names + their payload shapes. */

export const QUEUE = {
  nftMetadata: "nft.metadata",
  nftCollection: "nft.collection",
  tokenMetadata: "token.metadata",
  tokenCatalog: "token.catalog",
  issuerMetadata: "issuer.metadata",
  statsRollup: "stats.rollup",
  discoveryScan: "discovery.scan",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface JobPayloads {
  "nft.metadata": { nftTokenId: string; uri: string | null };
  /** One job = one whole issuer catalog (all taxa, live + burned) pulled in bulk. */
  "nft.collection": { issuer: string };
  "token.metadata": { tokenId: number };
  /** Paginate the entire xrplmeta token list and bulk-upsert token + issuer meta. */
  "token.catalog": Record<string, never>;
  "issuer.metadata": { accountId: number; address: string };
  "stats.rollup": Record<string, never>;
  "discovery.scan": { kinds?: ("nft" | "token" | "issuer")[] };
}

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE);
