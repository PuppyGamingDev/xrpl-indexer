import { bigint, integer, numeric, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { account } from "./accounts.ts";
import { token } from "./tokens.ts";

/** AMM pools. Reserves are read from the pseudo-account's accountBalance rows. */
export const amm = pgTable("amm", {
  accountId: bigint("account_id", { mode: "number" })
    .primaryKey()
    .references(() => account.id),
  asset1TokenId: bigint("asset1_token_id", { mode: "number" })
    .notNull()
    .references(() => token.id),
  asset2TokenId: bigint("asset2_token_id", { mode: "number" })
    .notNull()
    .references(() => token.id),
  lpTokenCurrency: varchar("lp_token_currency", { length: 40 }).notNull(),
  tradingFee: integer("trading_fee").notNull().default(0),
  createdLedgerSeq: integer("created_ledger_seq").notNull(),
});

/** Single-asset vaults (XLS-65). */
export const vault = pgTable("vault", {
  vaultId: varchar("vault_id", { length: 64 }).primaryKey(),
  ownerId: bigint("owner_id", { mode: "number" })
    .notNull()
    .references(() => account.id),
  pseudoAccountId: bigint("pseudo_account_id", { mode: "number" }).references(() => account.id),
  assetTokenId: bigint("asset_token_id", { mode: "number" })
    .notNull()
    .references(() => token.id),
  shareMptId: varchar("share_mpt_id", { length: 48 }),
  assetsTotal: numeric("assets_total"),
  assetsAvailable: numeric("assets_available"),
  assetsMaximum: numeric("assets_maximum"),
  flags: integer("flags").notNull().default(0),
  ledgerSeq: integer("ledger_seq").notNull(),
});

/** Price oracles (XLS-47). */
export const oracle = pgTable("oracle", {
  oracleId: varchar("oracle_id", { length: 64 }).primaryKey(),
  ownerId: bigint("owner_id", { mode: "number" })
    .notNull()
    .references(() => account.id),
  provider: text("provider"),
  assetClass: text("asset_class"),
  uri: text("uri"),
  lastUpdateTime: integer("last_update_time"),
  priceDataCount: integer("price_data_count"),
  ledgerSeq: integer("ledger_seq").notNull(),
});
