import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { account } from "./accounts.ts";

/** issuer + taxon grouping. */
export const nftCollection = pgTable(
  "nft_collection",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    issuerId: bigint("issuer_id", { mode: "number" })
      .notNull()
      .references(() => account.id),
    taxon: bigint("taxon", { mode: "number" }).notNull(),
    firstSeenLedger: integer("first_seen_ledger").notNull(),
  },
  (t) => [uniqueIndex("nft_collection_uq").on(t.issuerId, t.taxon)],
);

export const nft = pgTable(
  "nft",
  {
    /** 64-hex NFTokenID. */
    tokenId: varchar("token_id", { length: 64 }).primaryKey(),
    issuerId: bigint("issuer_id", { mode: "number" })
      .notNull()
      .references(() => account.id),
    ownerId: bigint("owner_id", { mode: "number" }).references(() => account.id),
    collectionId: bigint("collection_id", { mode: "number" }).references(() => nftCollection.id),
    taxon: bigint("taxon", { mode: "number" }).notNull(),
    serial: bigint("serial", { mode: "number" }).notNull(),
    flags: integer("flags").notNull().default(0),
    transferFee: integer("transfer_fee").notNull().default(0),
    /** Decoded on-chain URI, verbatim (may be ipfs://, https://, data:, ...). */
    uri: text("uri"),
    /** Null when first seen via an offer/sale rather than its mint. */
    mintLedgerSeq: integer("mint_ledger_seq"),
    burnLedgerSeq: integer("burn_ledger_seq"),
    live: boolean("live").notNull().default(true),
  },
  (t) => [
    index("nft_owner_idx").on(t.ownerId),
    index("nft_collection_idx").on(t.collectionId, t.serial),
    index("nft_issuer_taxon_idx").on(t.issuerId, t.taxon),
  ],
);

export const nftOffer = pgTable(
  "nft_offer",
  {
    offerId: varchar("offer_id", { length: 64 }).primaryKey(),
    nftTokenId: varchar("nft_token_id", { length: 64 })
      .notNull()
      .references(() => nft.tokenId),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => account.id),
    /** { currency, issuer|null, value } */
    amount: jsonb("amount").notNull(),
    isSell: boolean("is_sell").notNull(),
    destinationId: bigint("destination_id", { mode: "number" }).references(() => account.id),
    expiration: integer("expiration"),
    createdLedgerSeq: integer("created_ledger_seq").notNull(),
    closedLedgerSeq: integer("closed_ledger_seq"),
  },
  (t) => [
    index("nft_offer_token_idx").on(t.nftTokenId),
    index("nft_offer_open_idx").on(t.nftTokenId, t.closedLedgerSeq),
  ],
);

/** Completed NFT sales. Append-only. */
export const nftExchange = pgTable(
  "nft_exchange",
  {
    txHash: varchar("tx_hash", { length: 64 }).notNull(),
    idx: integer("idx").notNull(),
    nftTokenId: varchar("nft_token_id", { length: 64 })
      .notNull()
      .references(() => nft.tokenId),
    sellerId: bigint("seller_id", { mode: "number" }).references(() => account.id),
    buyerId: bigint("buyer_id", { mode: "number" }).references(() => account.id),
    /** { currency, issuer|null, value } */
    amount: jsonb("amount").notNull(),
    ledgerSeq: integer("ledger_seq").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.idx] }),
    index("nft_exchange_token_idx").on(t.nftTokenId, t.ledgerSeq),
    index("nft_exchange_ledger_idx").on(t.ledgerSeq),
  ],
);
