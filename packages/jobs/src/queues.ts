/** Canonical queue names + their payload shapes. */

export const QUEUE = {
  nftMetadata: "nft.metadata",
  nftCollection: "nft.collection",
  tokenMetadata: "token.metadata",
  issuerMetadata: "issuer.metadata",
  statsRollup: "stats.rollup",
  discoveryScan: "discovery.scan",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface JobPayloads {
  "nft.metadata": { nftTokenId: string; uri: string | null };
  "nft.collection": { collectionId: number; issuer: string; taxon: number };
  "token.metadata": { tokenId: number };
  "issuer.metadata": { accountId: number; address: string };
  "stats.rollup": Record<string, never>;
  "discovery.scan": { kinds?: ("nft" | "token" | "issuer")[] };
}

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE);
