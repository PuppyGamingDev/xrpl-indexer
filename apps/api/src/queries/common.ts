import { type Db, sql } from "@xrpl-indexer/db";

export interface Page {
  limit: number;
  offset: number;
}

export function parsePage(q: { limit?: unknown; offset?: unknown }, def = 25, max = 1000): Page {
  const limit = Math.min(Math.max(Number(q.limit) || def, 1), max);
  const offset = Math.max(Number(q.offset) || 0, 0);
  return { limit, offset };
}

export interface ListParams extends Page {
  sortBy: string;
  order: "asc" | "desc";
}

/** Pagination + a whitelisted sort column + direction, for list endpoints. */
export function parseList(
  q: Record<string, unknown>,
  opts: { sortable: readonly string[]; defaultSort: string; def?: number; max?: number },
): ListParams {
  const page = parsePage(q, opts.def ?? 25, opts.max ?? 200);
  const sortBy = opts.sortable.includes(String(q.sortBy)) ? String(q.sortBy) : opts.defaultSort;
  const order = String(q.order).toLowerCase() === "asc" ? "asc" : "desc";
  return { ...page, sortBy, order };
}

/** `<dir> nulls last` fragment for an `order by`. */
export const orderDir = (order: "asc" | "desc") =>
  order === "asc" ? sql`asc nulls last` : sql`desc nulls last`;

export async function currentLedger(db: Db): Promise<{ sequence: number; closeTime: string } | null> {
  const [row] = await db.execute<{ sequence: number; close_time: string }>(
    sql`select sequence, close_time from ledger order by sequence desc limit 1`,
  );
  return row ? { sequence: row.sequence, closeTime: row.close_time } : null;
}

/** As-of value of a sparse metric-point table. */
export async function metricAsOf(
  db: Db,
  table: "token_supply" | "token_holders" | "token_trustlines" | "token_marketcap",
  tokenId: number,
  ledgerSeq?: number,
): Promise<string | null> {
  const cap = ledgerSeq ?? 2_147_483_647;
  const [row] = await db.execute<{ value: string }>(sql`
    select value from ${sql.raw(table)}
    where token_id = ${tokenId} and ledger_seq <= ${cap}
    order by ledger_seq desc limit 1
  `);
  return row?.value ?? null;
}

/** Latest XRP-denominated price from the trade log. */
export async function lastPriceXrp(db: Db, tokenId: number): Promise<string | null> {
  const [row] = await db.execute<{ price: string }>(sql`
    with xrp as (select id from token where token_type = 'XRP' limit 1)
    select
      case
        when te.taker_got_token_id = ${tokenId}
          then (te.taker_paid_value / nullif(te.taker_got_value, 0))
        else (te.taker_got_value / nullif(te.taker_paid_value, 0))
      end::text as price
    from token_exchange te, xrp
    where (te.taker_got_token_id = ${tokenId} and te.taker_paid_token_id = xrp.id)
       or (te.taker_paid_token_id = ${tokenId} and te.taker_got_token_id = xrp.id)
    order by te.ledger_seq desc, te.idx desc
    limit 1
  `);
  return row?.price ?? null;
}

export function sampleSequence(start: number, end: number, points: number): number[] {
  if (points <= 1 || end <= start) return [end];
  const step = (end - start) / (points - 1);
  return Array.from({ length: points }, (_, i) => Math.round(start + step * i));
}
