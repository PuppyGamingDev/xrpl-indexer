import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { account } from "./accounts.ts";
import { tokenType } from "./enums.ts";

/**
 * A fungible asset: XRP (id 1), an IOU (currency + issuer), or an MPT
 * (mptIssuanceId). MPTs deliberately share this table and every downstream
 * table (accountBalance, tokenHolders, ...) with IOUs.
 */
export const token = pgTable(
  "token",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tokenType: tokenType("token_type").notNull(),
    /** IOU: 3-char or 40-hex currency. MPT/XRP: null. */
    currency: varchar("currency", { length: 40 }),
    issuerId: bigint("issuer_id", { mode: "number" }).references(() => account.id),
    /** MPT only: the 192-bit issuance id as hex. */
    mptIssuanceId: varchar("mpt_issuance_id", { length: 48 }),
    firstSeenLedger: integer("first_seen_ledger").notNull(),
  },
  (t) => [
    // One row per (currency, issuer) IOU.
    uniqueIndex("token_iou_uq")
      .on(t.currency, t.issuerId)
      .where(sql`${t.tokenType} = 'IOU'`),
    // One row per MPT issuance.
    uniqueIndex("token_mpt_uq")
      .on(t.mptIssuanceId)
      .where(sql`${t.tokenType} = 'MPT'`),
    // Exactly one XRP row.
    uniqueIndex("token_xrp_uq")
      .on(t.tokenType)
      .where(sql`${t.tokenType} = 'XRP'`),
    index("token_issuer_idx").on(t.issuerId),
  ],
);

/**
 * Append-only per-ledger balance-change log. One row whenever an account's
 * holding of a token changes. Shared by IOU trustlines, MPT holdings, and
 * AMM/Vault pseudo-account reserves. Range-partition by ledgerSeq in prod.
 */
export const accountBalance = pgTable(
  "account_balance",
  {
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => account.id),
    tokenId: bigint("token_id", { mode: "number" })
      .notNull()
      .references(() => token.id),
    ledgerSeq: integer("ledger_seq").notNull(),
    /** Signed balance after the change (IOU can be negative from the issuer side). */
    balance: numeric("balance").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.tokenId, t.ledgerSeq] }),
    // Drives `DISTINCT ON (account_id) ... ORDER BY account_id, ledger_seq DESC`
    // for "current holders of a token".
    index("account_balance_holders_idx").on(t.tokenId, t.accountId, t.ledgerSeq.desc()),
    // Point-in-time "balance of account X as of ledger N".
    index("account_balance_asof_idx").on(t.accountId, t.tokenId, t.ledgerSeq.desc()),
  ],
);

/** DEX trades (Payment / OfferCreate crossings). Append-only. */
export const tokenExchange = pgTable(
  "token_exchange",
  {
    txHash: varchar("tx_hash", { length: 64 }).notNull(),
    idx: integer("idx").notNull(),
    ledgerSeq: integer("ledger_seq").notNull(),
    takerPaidTokenId: bigint("taker_paid_token_id", { mode: "number" })
      .notNull()
      .references(() => token.id),
    takerPaidValue: numeric("taker_paid_value").notNull(),
    takerGotTokenId: bigint("taker_got_token_id", { mode: "number" })
      .notNull()
      .references(() => token.id),
    takerGotValue: numeric("taker_got_value").notNull(),
    takerId: bigint("taker_id", { mode: "number" }).references(() => account.id),
    makerId: bigint("maker_id", { mode: "number" }).references(() => account.id),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.idx] }),
    index("token_exchange_pair_idx").on(t.takerPaidTokenId, t.takerGotTokenId, t.ledgerSeq),
    index("token_exchange_ledger_idx").on(t.ledgerSeq),
  ],
);
