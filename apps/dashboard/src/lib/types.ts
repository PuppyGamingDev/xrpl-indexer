export interface ServerStats {
  ledger: {
    latestSequence: number | null;
    firstSequence: number | null;
    closeTime: string | null;
    lagSeconds: number | null;
  };
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
  first_seen_ledger: number;
  issuer: string;
  blackholed: boolean;
  name: string | null;
  icon_uri: string | null;
  trust_level: number | null;
  domain: string | null;
  holders: string;
  trustlines: string;
  supply: string;
  marketcap: string;
  volume_24h: string;
  volume_7d: string;
  trades_24h: number;
}

export interface CollectionRow {
  id: string;
  issuer: string;
  taxon: string;
  first_seen_ledger: number;
  name: string | null;
  image_uri: string | null;
  supply: number;
  holders: number;
  floor: string | null;
  volume_24h: string;
  volume_7d: string;
  volume_all: string;
  trades_24h: number;
  trades_7d: number;
  live_supply: number;
}

export interface ListResponse {
  sortBy: string;
  order: "asc" | "desc";
  limit: number;
  offset: number;
  total: number;
}

export interface QueueDepths {
  queues: Record<string, { queued: number; active: number }>;
}
