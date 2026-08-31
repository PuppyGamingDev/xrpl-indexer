import { bigint, boolean, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";

/** Every XRPL account we have seen, keyed by a compact surrogate id. */
export const account = pgTable("account", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  address: varchar("address", { length: 40 }).notNull().unique(),
  /** Issuer accounts whose regular key is disabled + master key removed. */
  blackholed: boolean("blackholed").notNull().default(false),
  /** AMM / Vault pseudo-accounts (no owner can sign). */
  pseudo: boolean("pseudo").notNull().default(false),
  /** "amm" | "vault" | null — why this account is a pseudo-account. */
  pseudoSource: varchar("pseudo_source", { length: 16 }),
  /** Decoded AccountRoot.Domain, if set. */
  domain: text("domain"),
  flags: bigint("flags", { mode: "number" }).notNull().default(0),
  firstSeenLedger: integer("first_seen_ledger").notNull(),
});
