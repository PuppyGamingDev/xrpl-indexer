export interface ServerStats {
  ledger: { latestSequence: number | null; closeTime: string | null; lagSeconds: number | null };
  tokens: { total: number; iou: number; mpt: number };
  nfts: { total: number; live: number; burned: number; withUri: number };
  collections: { total: number };
  issuers: { token: number; nft: number };
  defi: { amm: number; vaults: number; oracles: number };
  accounts: number;
  coverage: { tokensWithMeta: number; nftsWithMeta: number; nftsWithAttributes: number };
}

export interface StatsHistoryRow {
  ts: string;
  stats: Record<string, string | number>;
}

export interface TokenRow {
  id: string;
  token_type: "IOU" | "MPT";
  currency: string | null;
  mpt_issuance_id: string | null;
  issuer: string;
  blackholed: boolean;
  name: string | null;
  icon_uri: string | null;
  trust_level: number | null;
  holders: string;
  trustlines: string;
  supply: string;
}

export interface QueueDepths {
  queues: Record<string, { queued: number; active: number }>;
}
