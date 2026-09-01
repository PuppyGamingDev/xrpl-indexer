import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { EnrichContext } from "./context.ts";

const { dashboardSnapshot } = schema;
const log = createLogger("enrich.rollup");

/** Recompute the denormalised stat tables + append a dashboard snapshot. */
export async function runRollup(ctx: EnrichContext): Promise<void> {
  await ctx.db.transaction(async (db) => {
    // Batch job over growing history tables — raise the 30s web timeout, but
    // keep it bounded so a bad plan aborts instead of running for 30 min. Skip
    // parallel workers (DSM pressure in the container's /dev/shm), and give
    // hashes/sorts enough memory to stay off disk.
    await db.execute(sql`set local statement_timeout = '600s'`);
    await db.execute(sql`set local max_parallel_workers_per_gather = 0`);
    await db.execute(sql`set local work_mem = '256MB'`);

    // token_stats — most of the ~1.75M IOU tokens are dead spam trustline pairs.
    // Take the latest metric point per token in one index pass each, then only
    // recompute stats for tokens that currently have holders/trustlines, have
    // metadata, or traded recently.
    // Candidate set from the two metric tables + metadata (both ~1.7M rows,
    // resolved by the PK index). Trade aggregates from ONE grouped pass over the
    // last 7 days of token_exchange (there's no index on the taker token cols,
    // so a per-candidate lateral would seq-scan the whole table each time).
    await db.execute(sql`
      with lh as (select distinct on (token_id) token_id, value from token_holders    order by token_id, ledger_seq desc),
           lt as (select distinct on (token_id) token_id, value from token_trustlines order by token_id, ledger_seq desc),
           cand as (
             select t.id,
                    coalesce(lh.value, 0) as holders,
                    coalesce(lt.value, 0) as trustlines
             from token t
             left join lh on lh.token_id = t.id
             left join lt on lt.token_id = t.id
             where t.token_type <> 'XRP'
               and ( coalesce(lh.value,0) > 0
                  or coalesce(lt.value,0) > 0
                  or exists (select 1 from token_meta m where m.token_id = t.id and m.error is null) )
           ),
           ex as (
             select te.taker_got_token_id as token_id, te.taker_got_value as val, te.taker_id, l.close_time
             from token_exchange te join ledger l on l.sequence = te.ledger_seq
             where l.close_time > now() - interval '7 days'
             union all
             select te.taker_paid_token_id, te.taker_got_value, te.taker_id, l.close_time
             from token_exchange te join ledger l on l.sequence = te.ledger_seq
             where l.close_time > now() - interval '7 days'
           ),
           vol as (
             select token_id,
               sum(val) filter (where close_time > now() - interval '24 hours') as vol_24h,
               sum(val) as vol_7d,
               count(*) filter (where close_time > now() - interval '24 hours') as ex_24h,
               count(*) as ex_7d,
               count(distinct taker_id) filter (where close_time > now() - interval '24 hours') as tk_24h,
               count(distinct taker_id) as tk_7d
             from ex group by token_id
           )
      insert into token_stats (token_id, holders, trustlines, supply, marketcap, price,
                               volume_24h, volume_7d, exchanges_24h, exchanges_7d,
                               takers_24h, takers_7d, computed_at)
      select
        c.id,
        c.holders::int,
        c.trustlines::int,
        coalesce((select value from token_supply    where token_id=c.id order by ledger_seq desc limit 1),0),
        coalesce((select value from token_marketcap where token_id=c.id order by ledger_seq desc limit 1),0),
        0,
        coalesce(v.vol_24h,0), coalesce(v.vol_7d,0),
        coalesce(v.ex_24h,0), coalesce(v.ex_7d,0),
        coalesce(v.tk_24h,0), coalesce(v.tk_7d,0),
        now()
      from cand c
      left join vol v on v.token_id = c.id
      on conflict (token_id) do update set
        holders = excluded.holders, trustlines = excluded.trustlines, supply = excluded.supply,
        marketcap = excluded.marketcap, volume_24h = excluded.volume_24h, volume_7d = excluded.volume_7d,
        exchanges_24h = excluded.exchanges_24h, exchanges_7d = excluded.exchanges_7d,
        takers_24h = excluded.takers_24h, takers_7d = excluded.takers_7d, computed_at = now()
    `);

    // nft_collection_stats — one grouped pass over nft + one over nft_exchange,
    // not a correlated lateral per collection.
    await db.execute(sql`
      with sup as (
        select collection_id,
               count(*) filter (where live) as supply,
               count(distinct owner_id) filter (where live) as holders
        from nft where collection_id is not null
        group by collection_id
      ),
      vol as (
        select n.collection_id,
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
        where n.collection_id is not null
        group by n.collection_id
      )
      insert into nft_collection_stats (collection_id, supply, holders, floor, volume_24h, volume_7d, volume_all,
                                        trades_24h, trades_7d, computed_at)
      select c.id,
        coalesce(sup.supply,0), coalesce(sup.holders,0), 0,
        coalesce(vol.v24,0), coalesce(vol.v7,0), coalesce(vol.vall,0),
        coalesce(vol.t24,0), coalesce(vol.t7,0), now()
      from nft_collection c
      left join sup on sup.collection_id = c.id
      left join vol on vol.collection_id = c.id
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
