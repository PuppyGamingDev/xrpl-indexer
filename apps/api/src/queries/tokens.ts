import { currencyToString } from "@xrpl-indexer/codec";
import { NotFoundError } from "@xrpl-indexer/core/errors";
import { type Db, sql } from "@xrpl-indexer/db";
import { lastPriceXrp, type ListParams, metricAsOf, orderDir, type Page, sampleSequence } from "./common.ts";

export interface TokenRef {
  id: number;
  tokenType: "IOU" | "MPT";
  currency: string | null;
  issuer: string;
  mptIssuanceId: string | null;
}

async function resolveIou(db: Db, issuer: string, currency: string): Promise<TokenRef> {
  const hex = currency.length > 3 ? currency.toUpperCase() : currencyToString(currency);
  const [row] = await db.execute<{ id: number; currency: string }>(sql`
    select t.id, t.currency from token t
    join account a on a.id = t.issuer_id
    where t.token_type = 'IOU' and a.address = ${issuer}
      and (t.currency = ${currency} or t.currency = ${hex})
    limit 1
  `);
  if (!row) throw new NotFoundError("token not found");
  return { id: row.id, tokenType: "IOU", currency: currencyToString(row.currency), issuer, mptIssuanceId: null };
}

async function resolveMpt(db: Db, mptIssuanceId: string): Promise<TokenRef> {
  const [row] = await db.execute<{ id: number; issuer: string }>(sql`
    select t.id, a.address as issuer from token t
    join account a on a.id = t.issuer_id
    where t.token_type = 'MPT' and t.mpt_issuance_id = ${mptIssuanceId.toUpperCase()}
    limit 1
  `);
  if (!row) throw new NotFoundError("MPT not found");
  return { id: row.id, tokenType: "MPT", currency: null, issuer: row.issuer, mptIssuanceId: mptIssuanceId.toUpperCase() };
}

export const resolveToken = { iou: resolveIou, mpt: resolveMpt };

export interface TokenDetail extends TokenRef {
  blackholed: boolean;
  issuerPseudo: boolean;
  pseudoSource: string | null;
  holders: number;
  trustlines: number;
  supply: string;
  priceXrp: string | null;
  meta: Record<string, unknown> | null;
}

export async function getTokenDetail(db: Db, ref: TokenRef): Promise<TokenDetail> {
  const [acct] = await db.execute<{ blackholed: boolean; pseudo: boolean; pseudo_source: string | null }>(sql`
    select a.blackholed, a.pseudo, a.pseudo_source
    from token t join account a on a.id = t.issuer_id
    where t.id = ${ref.id}
  `);
  const [meta] = await db.execute<Record<string, unknown>>(sql`
    select name, description, icon_uri, domain, links, trust_level, source
    from token_meta where token_id = ${ref.id}
  `);

  const [holders, trustlines, supply] = await Promise.all([
    metricAsOf(db, "token_holders", ref.id),
    metricAsOf(db, "token_trustlines", ref.id),
    metricAsOf(db, "token_supply", ref.id),
  ]);

  return {
    ...ref,
    blackholed: acct?.blackholed ?? false,
    issuerPseudo: acct?.pseudo ?? false,
    pseudoSource: acct?.pseudo_source ?? null,
    holders: Number(holders ?? 0),
    trustlines: Number(trustlines ?? 0),
    supply: supply ?? "0",
    priceXrp: await lastPriceXrp(db, ref.id),
    meta: meta ?? null,
  };
}

export interface HolderRow {
  account: string;
  balance: string;
  percent: number;
  pool: boolean;
  poolSource: string | null;
}

export async function getTokenHolders(
  db: Db,
  ref: TokenRef,
  page: Page,
): Promise<{ totalHolders: number; totalSupply: string; holders: HolderRow[] }> {
  const rows = await db.execute<{
    address: string;
    balance: string;
    pseudo: boolean;
    pseudo_source: string | null;
    total_holders: number;
    total_supply: string;
  }>(sql`
    with latest as (
      select distinct on (account_id) account_id, balance
      from account_balance
      where token_id = ${ref.id}
      order by account_id, ledger_seq desc
    ),
    positive as (select * from latest where balance > 0),
    agg as (select count(*)::int as total_holders, coalesce(sum(balance), 0)::text as total_supply from positive)
    select a.address, p.balance::text as balance, a.pseudo, a.pseudo_source,
           agg.total_holders, agg.total_supply
    from positive p
    join account a on a.id = p.account_id
    cross join agg
    order by p.balance desc
    limit ${page.limit} offset ${page.offset}
  `);

  const totalHolders = rows[0]?.total_holders ?? 0;
  const totalSupply = rows[0]?.total_supply ?? "0";
  const supplyNum = Number(totalSupply) || 1;

  return {
    totalHolders,
    totalSupply,
    holders: rows.map((r) => ({
      account: r.address,
      balance: r.balance,
      percent: (Number(r.balance) / supplyNum) * 100,
      pool: r.pseudo,
      poolSource: r.pseudo_source,
    })),
  };
}

export type MetricName = "price" | "trustlines" | "holders" | "supply" | "marketcap";

export async function getMetricSeries(
  db: Db,
  ref: TokenRef,
  metric: MetricName,
  opts: { startSequence?: number; endSequence?: number; points: number },
): Promise<{ metric: MetricName; series: { ledgerSequence: number; value: string | null }[] }> {
  const [range] = await db.execute<{ lo: number; hi: number }>(sql`
    select min(sequence) as lo, max(sequence) as hi from ledger
  `);
  const lo = opts.startSequence ?? range?.lo ?? 0;
  const hi = opts.endSequence ?? range?.hi ?? 0;
  const seqs = sampleSequence(lo, hi, opts.points);

  const table =
    metric === "trustlines"
      ? "token_trustlines"
      : metric === "holders"
        ? "token_holders"
        : metric === "marketcap"
          ? "token_marketcap"
          : "token_supply";

  const series: { ledgerSequence: number; value: string | null }[] = [];
  for (const seq of seqs) {
    if (metric === "price") {
      const [row] = await db.execute<{ price: string }>(sql`
        with xrp as (select id from token where token_type='XRP' limit 1)
        select case when te.taker_got_token_id = ${ref.id}
                    then (te.taker_paid_value / nullif(te.taker_got_value,0))
                    else (te.taker_got_value / nullif(te.taker_paid_value,0)) end::text as price
        from token_exchange te, xrp
        where te.ledger_seq <= ${seq}
          and ((te.taker_got_token_id = ${ref.id} and te.taker_paid_token_id = xrp.id)
            or (te.taker_paid_token_id = ${ref.id} and te.taker_got_token_id = xrp.id))
        order by te.ledger_seq desc, te.idx desc limit 1
      `);
      series.push({ ledgerSequence: seq, value: row?.price ?? null });
    } else {
      series.push({ ledgerSequence: seq, value: await metricAsOf(db, table, ref.id, seq) });
    }
  }
  return { metric, series };
}

export const TOKEN_SORTS = [
  "holders",
  "trustlines",
  "supply",
  "marketcap",
  "volume24h",
  "volume7d",
  "trades24h",
  "age",
  "name",
] as const;

export interface ListTokensParams extends ListParams {
  /** matches token_meta.name, currency code, or exact issuer address */
  search?: string;
  issuer?: string;
  type?: "IOU" | "MPT";
  verified?: boolean;
}

export interface ListTokensResult extends ListParams {
  total: number;
  tokens: Record<string, unknown>[];
}

export async function listTokens(db: Db, p: ListTokensParams): Promise<ListTokensResult> {
  const sortCol =
    p.sortBy === "trustlines"
      ? sql`coalesce(th.value, 0)`
      : p.sortBy === "supply"
        ? sql`coalesce(tsup.value, 0)`
        : p.sortBy === "marketcap"
          ? sql`coalesce(st.marketcap, 0)`
          : p.sortBy === "volume24h"
            ? sql`coalesce(st.volume_24h, 0)`
            : p.sortBy === "volume7d"
              ? sql`coalesce(st.volume_7d, 0)`
              : p.sortBy === "trades24h"
                ? sql`coalesce(st.exchanges_24h, 0)`
                : p.sortBy === "age"
                  ? sql`t.first_seen_ledger`
                  : p.sortBy === "name"
                    ? sql`lower(tm.name)`
                    : sql`coalesce(thold.value, 0)`;

  const s = p.search?.trim();
  const like = s ? `%${s}%` : "";
  // Dead spam trustline pairs have no token_stats row and no metadata — hide
  // them from an unfiltered browse so the sort + count stay cheap.
  const browseOnly = !s && !p.issuer;

  const rows = await db.execute<Record<string, unknown> & { total: number }>(sql`
    select
      t.id, t.token_type, t.currency, t.mpt_issuance_id, t.first_seen_ledger,
      a.address as issuer, a.blackholed, a.pseudo,
      tm.name, tm.icon_uri, tm.trust_level, tm.domain,
      coalesce(thold.value, 0)::text  as holders,
      coalesce(th.value, 0)::text     as trustlines,
      coalesce(tsup.value, 0)::text   as supply,
      coalesce(st.marketcap, 0)::text as marketcap,
      coalesce(st.volume_24h, 0)::text as volume_24h,
      coalesce(st.volume_7d, 0)::text  as volume_7d,
      coalesce(st.exchanges_24h, 0)    as trades_24h,
      count(*) over()::int as total
    from token t
    join account a on a.id = t.issuer_id
    left join lateral (select value from token_holders     where token_id = t.id order by ledger_seq desc limit 1) thold on true
    left join lateral (select value from token_trustlines  where token_id = t.id order by ledger_seq desc limit 1) th on true
    left join lateral (select value from token_supply      where token_id = t.id order by ledger_seq desc limit 1) tsup on true
    left join token_meta  tm on tm.token_id = t.id
    left join token_stats st on st.token_id = t.id
    where t.token_type <> 'XRP'
      ${browseOnly ? sql`and st.token_id is not null` : sql``}
      ${p.type ? sql`and t.token_type = ${p.type}` : sql``}
      ${p.issuer ? sql`and a.address = ${p.issuer}` : sql``}
      ${p.verified ? sql`and coalesce(tm.trust_level, 0) >= 2` : sql``}
      ${s ? sql`and (tm.name ilike ${like} or t.currency ilike ${like} or a.address = ${s})` : sql``}
    order by ${sortCol} ${orderDir(p.order)}, t.id
    limit ${p.limit} offset ${p.offset}
  `);

  const list = [...rows];
  const total = list[0]?.total ?? 0;
  for (const r of list) delete (r as { total?: number }).total;
  return { sortBy: p.sortBy, order: p.order, limit: p.limit, offset: p.offset, total, tokens: list };
}
