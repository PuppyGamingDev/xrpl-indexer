import { bigint, integer, numeric, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { token } from "./tokens.ts";

/**
 * Sparse "value changed at this ledger" point series, one table per metric.
 * A row is written only when the value differs from the previous one, so an
 * as-of lookup is `... WHERE token_id = ? AND ledger_seq <= ? ORDER BY ledger_seq DESC LIMIT 1`.
 * Price has no table here — it is derived from tokenExchange.
 */
function metricTable(name: string) {
  return pgTable(
    name,
    {
      tokenId: bigint("token_id", { mode: "number" })
        .notNull()
        .references(() => token.id),
      ledgerSeq: integer("ledger_seq").notNull(),
      value: numeric("value").notNull(),
    },
    (t) => [primaryKey({ columns: [t.tokenId, t.ledgerSeq] })],
  );
}

export const tokenSupply = metricTable("token_supply");
export const tokenHolders = metricTable("token_holders");
export const tokenTrustlines = metricTable("token_trustlines");
export const tokenMarketcap = metricTable("token_marketcap");
