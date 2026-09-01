import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { EnrichContext } from "./context.ts";

const { dashboardSnapshot } = schema;
const log = createLogger("enrich.rollup");

/** Recompute the denormalised stat tables + append a dashboard snapshot. */
export async function runRollup(ctx: EnrichContext): Promise<void> {
  await ctx.db.transaction(async (db) => {
    // Batch job over growing history tables — lift the 30s web timeout, and skip
    // parallel workers (DSM pressure in the container's /dev/shm).
    await db.execute(sql`set local statement_timeout = 0`);
    await db.execute(sql`set local max_parallel_workers_per_gather = 0`);

    // token_stats: latest metric points + 24h/7d trade aggregates
    await db.execute(sql`
      insert into token_stats (token_id, holders, trustlines, supply, marketcap, price,
                               volume_24h, volume_7d, exchanges_24h, exchanges_7d,
                               takers_24h, takers_7d, computed_at)
      select
        t.id,
        coalesce((select value::numeric from token_holders    where token_id=t.id order by ledger_seq desc limit 1),0)::int,
        coalesce((select value::numeric from token_trustlines where token_id=t.id order by ledger_seq desc limit 1),0)::int,
        coalesce((select value from token_supply    where token_id=t.id order by ledger_seq desc limit 1),0),
        coalesce((select value from token_marketcap where token_id=t.id order by ledger_seq desc limit 1),0),
        0,
        coalesce(v.vol_24h,0), coalesce(v.vol_7d,0),
        coalesce(v.ex_24h,0), coalesce(v.ex_7d,0),
        coalesce(v.tk_24h,0), coalesce(v.tk_7d,0),
        now()
      from token t
      left join lateral (
        select
          sum(case when l.close_time > now() - interval '24 hours' then te.taker_got_value else 0 end) as vol_24h,
          sum(case when l.close_time > now() - interval '7 days'  then te.taker_got_value else 0 end) as vol_7d,
          count(*) filter (where l.close_time > now() - interval '24 hours') as ex_24h,
          count(*) filter (where l.close_time > now() - interval '7 days')  as ex_7d,
          count(distinct te.taker_id) filter (where l.close_time > now() - interval '24 hours') as tk_24h,
          count(distinct te.taker_id) filter (where l.close_time > now() - interval '7 days')  as tk_7d
        from token_exchange te join ledger l on l.sequence = te.ledger_seq
        where (te.taker_got_token_id = t.id or te.taker_paid_token_id = t.id)
          and l.close_time > now() - interval '7 days'
      ) v on true
      where t.token_type <> 'XRP'
      on conflict (token_id) do update set
        holders = excluded.holders, trustlines = excluded.trustlines, supply = excluded.supply,
        marketcap = excluded.marketcap, volume_24h = excluded.volume_24h, volume_7d = excluded.volume_7d,
        exchanges_24h = excluded.exchanges_24h, exchanges_7d = excluded.exchanges_7d,
        takers_24h = excluded.takers_24h, takers_7d = excluded.takers_7d, computed_at = now()
    `);

    // nft_collection_stats: supply/holders/floor/volume from base tables
    await db.execute(sql`
      insert into nft_collection_stats (collection_id, supply, holders, floor, volume_24h, volume_7d, volume_all,
                                        trades_24h, trades_7d, computed_at)
      select
        c.id,
        (select count(*) from nft n where n.collection_id=c.id and n.live),
        (select count(distinct owner_id) from nft n where n.collection_id=c.id and n.live),
        0,
        coalesce(x.v24,0), coalesce(x.v7,0), coalesce(x.vall,0),
        coalesce(x.t24,0), coalesce(x.t7,0),
        now()
      from nft_collection c
      left join lateral (
        select
          sum(case when l.close_time > now() - interval '24 hours' and (nx.amount->>'value') ~ '^[0-9.]+$'
                   then (nx.amount->>'value')::numeric else 0 end) as v24,
          sum(case when l.close_time > now() - interval '7 days' and (nx.amount->>'value') ~ '^[0-9.]+$'
                   then (nx.amount->>'value')::numeric else 0 end) as v7,
          sum(case when (nx.amount->>'value') ~ '^[0-9.]+$' then (nx.amount->>'value')::numeric else 0 end) as vall,
          count(*) filter (where l.close_time > now() - interval '24 hours') as t24,
          count(*) filter (where l.close_time > now() - interval '7 days')  as t7
        from nft_exchange nx
        join nft n on n.token_id = nx.nft_token_id
        join ledger l on l.sequence = nx.ledger_seq
        where n.collection_id = c.id
      ) x on true
      on conflict (collection_id) do update set
        supply = excluded.supply, holders = excluded.holders,
        volume_24h = excluded.volume_24h, volume_7d = excluded.volume_7d, volume_all = excluded.volume_all,
        trades_24h = excluded.trades_24h, trades_7d = excluded.trades_7d, computed_at = now()
    `);

    const [snap] = await db.execute<Record<string, string>>(sql`
      select
        (select max(sequence) from ledger)                                as latest_seq,
        (select count(*) from token where token_type<>'XRP')              as tokens,
        (select count(*) from token where token_type='MPT')              as mpts,
        (select count(*) from nft)                                        as nfts,
        (select count(*) from nft where live)                            as nfts_live,
        (select count(*) from nft_collection)                            as collections,
        (select count(distinct issuer_id) from nft)                      as nft_issuers,
        (select count(*) from nft_meta where error is null)              as nfts_with_meta,
        (select count(*) from nft_meta where error is null and attributes is not null and jsonb_array_length(attributes) > 0) as nfts_with_attrs,
        (select count(*) from token_meta where error is null)           as tokens_with_meta,
        (select count(*) from amm)                                       as amm,
        (select count(*) from vault)                                     as vaults,
        (select count(*) from oracle)                                     as oracles
    `);
    await db.insert(dashboardSnapshot).values({ stats: snap ?? {} });
  });

  log.info("rollup complete");
}
