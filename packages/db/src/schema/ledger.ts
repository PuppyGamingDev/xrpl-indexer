import { bigint, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { gapState } from "./enums.ts";

/** One row per validated ledger we have fully processed. */
export const ledger = pgTable("ledger", {
  sequence: integer("sequence").primaryKey(),
  hash: varchar("hash", { length: 64 }).notNull(),
  parentHash: varchar("parent_hash", { length: 64 }).notNull(),
  closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
  txnCount: integer("txn_count").notNull().default(0),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Singleton (id = 1) tracking the live-sync frontier. */
export const indexerCheckpoint = pgTable("indexer_checkpoint", {
  id: integer("id").primaryKey().default(1),
  lastLedgerSeq: integer("last_ledger_seq").notNull(),
  lastLedgerHash: varchar("last_ledger_hash", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Historical backfill work ranges (inclusive). */
export const ledgerGap = pgTable(
  "ledger_gap",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    rangeStart: integer("range_start").notNull(),
    rangeEnd: integer("range_end").notNull(),
    state: gapState("state").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_gap_state_idx").on(t.state, t.rangeStart)],
);
