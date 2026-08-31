import { type Db, sql } from "@xrpl-indexer/db";

export interface ServerStats {
  ledger: { latestSequence: number | null; closeTime: string | null; lagSeconds: number | null };
  tokens: { total: number; iou: number; mpt: number };
  nfts: { total: number; live: number; burned: number; withUri: number };
  collections: { total: number };
  issuers: { token: number; nft: number };
  defi: { amm: number; vaults: number; oracles: number };
  accounts: number;
  coverage: {
    tokensWithMeta: number;
    nftsWithMeta: number;
    nftsWithAttributes: number;
  };
}

export async function getServerStats(db: Db): Promise<ServerStats> {
  const [row] = await db.execute<Record<string, string>>(sql`
    select
      (select max(sequence) from ledger)                                          as latest_seq,
      (select extract(epoch from close_time)::text from ledger order by sequence desc limit 1) as close_epoch,
      (select count(*) from token where token_type <> 'XRP')                      as tokens_total,
      (select count(*) from token where token_type = 'IOU')                       as tokens_iou,
      (select count(*) from token where token_type = 'MPT')                       as tokens_mpt,
      (select count(*) from nft)                                                  as nfts_total,
      (select count(*) from nft where live)                                       as nfts_live,
      (select count(*) from nft where not live)                                   as nfts_burned,
      (select count(*) from nft where uri is not null)                            as nfts_with_uri,
      (select count(*) from nft_collection)                                       as collections_total,
      (select count(distinct issuer_id) from token where token_type <> 'XRP')     as issuers_token,
      (select count(distinct issuer_id) from nft)                                 as issuers_nft,
      (select count(*) from amm)                                                  as amm,
      (select count(*) from vault)                                                as vaults,
      (select count(*) from oracle)                                               as oracles,
      (select count(*) from account)                                             as accounts,
      (select count(*) from token_meta)                                          as tokens_with_meta,
      (select count(*) from nft_meta)                                            as nfts_with_meta,
      (select count(*) from nft_meta where attributes is not null and jsonb_array_length(attributes) > 0) as nfts_with_attrs
  `);

  const n = (k: string) => Number(row?.[k] ?? 0);
  const latestSequence = row?.latest_seq ? Number(row.latest_seq) : null;
  const closeEpoch = row?.close_epoch ? Number(row.close_epoch) : null;

  return {
    ledger: {
      latestSequence,
      closeTime: closeEpoch ? new Date(closeEpoch * 1000).toISOString() : null,
      lagSeconds: closeEpoch ? Math.max(0, Math.round(Date.now() / 1000 - closeEpoch)) : null,
    },
    tokens: { total: n("tokens_total"), iou: n("tokens_iou"), mpt: n("tokens_mpt") },
    nfts: {
      total: n("nfts_total"),
      live: n("nfts_live"),
      burned: n("nfts_burned"),
      withUri: n("nfts_with_uri"),
    },
    collections: { total: n("collections_total") },
    issuers: { token: n("issuers_token"), nft: n("issuers_nft") },
    defi: { amm: n("amm"), vaults: n("vaults"), oracles: n("oracles") },
    accounts: n("accounts"),
    coverage: {
      tokensWithMeta: n("tokens_with_meta"),
      nftsWithMeta: n("nfts_with_meta"),
      nftsWithAttributes: n("nfts_with_attrs"),
    },
  };
}

export async function getStatsHistory(db: Db, hours: number): Promise<{ ts: string; stats: unknown }[]> {
  const rows = await db.execute<{ ts: string; stats: unknown }>(sql`
    select ts::text, stats from dashboard_snapshot
    where ts > now() - (${hours} || ' hours')::interval
    order by ts asc
  `);
  return [...rows];
}
