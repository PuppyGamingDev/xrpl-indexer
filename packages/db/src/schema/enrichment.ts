import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { account } from "./accounts.ts";
import { metaSource } from "./enums.ts";
import { nft, nftCollection } from "./nfts.ts";
import { token } from "./tokens.ts";

/**
 * Off-chain token metadata. Written only by the backfiller/worker.
 * `*Uri` columns hold the CANONICAL link from the source (ipfs://, ar://,
 * data:, https://) — never a gateway URL, never downloaded bytes.
 */
export const tokenMeta = pgTable("token_meta", {
  tokenId: bigint("token_id", { mode: "number" })
    .primaryKey()
    .references(() => token.id),
  name: text("name"),
  description: text("description"),
  iconUri: text("icon_uri"),
  domain: text("domain"),
  links: jsonb("links"),
  trustLevel: integer("trust_level").notNull().default(0),
  source: metaSource("source").notNull(),
  raw: jsonb("raw"),
  error: text("error"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nftMeta = pgTable("nft_meta", {
  nftTokenId: varchar("nft_token_id", { length: 64 })
    .primaryKey()
    .references(() => nft.tokenId),
  name: text("name"),
  description: text("description"),
  /** Canonical primary-image link. */
  imageUri: text("image_uri"),
  /** Canonical animation/video/audio/model link when present. */
  mediaUri: text("media_uri"),
  mediaType: varchar("media_type", { length: 16 }),
  /** XLS-24 trait array, verbatim. */
  attributes: jsonb("attributes"),
  collectionName: text("collection_name"),
  source: metaSource("source").notNull(),
  error: text("error"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const issuerMeta = pgTable("issuer_meta", {
  accountId: bigint("account_id", { mode: "number" })
    .primaryKey()
    .references(() => account.id),
  name: text("name"),
  description: text("description"),
  iconUri: text("icon_uri"),
  twitter: text("twitter"),
  domain: text("domain"),
  verified: boolean("verified").notNull().default(false),
  source: metaSource("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Denormalised rollup recomputed by the `stats.rollup` job. Replaces cache.Token. */
export const tokenStats = pgTable("token_stats", {
  tokenId: bigint("token_id", { mode: "number" })
    .primaryKey()
    .references(() => token.id),
  holders: integer("holders").notNull().default(0),
  trustlines: integer("trustlines").notNull().default(0),
  supply: numeric("supply").notNull().default("0"),
  marketcap: numeric("marketcap").notNull().default("0"),
  price: numeric("price").notNull().default("0"),
  volume24h: numeric("volume_24h").notNull().default("0"),
  volume7d: numeric("volume_7d").notNull().default("0"),
  exchanges24h: integer("exchanges_24h").notNull().default(0),
  exchanges7d: integer("exchanges_7d").notNull().default(0),
  takers24h: integer("takers_24h").notNull().default(0),
  takers7d: integer("takers_7d").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nftCollectionStats = pgTable("nft_collection_stats", {
  collectionId: bigint("collection_id", { mode: "number" })
    .primaryKey()
    .references(() => nftCollection.id),
  name: text("name"),
  imageUri: text("image_uri"),
  supply: integer("supply").notNull().default(0),
  holders: integer("holders").notNull().default(0),
  floor: numeric("floor").notNull().default("0"),
  volume24h: numeric("volume_24h").notNull().default("0"),
  volume7d: numeric("volume_7d").notNull().default("0"),
  volumeAll: numeric("volume_all").notNull().default("0"),
  trades24h: integer("trades_24h").notNull().default(0),
  trades7d: integer("trades_7d").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Periodic global-stats snapshot for dashboard trend sparklines. */
export const dashboardSnapshot = pgTable("dashboard_snapshot", {
  ts: timestamp("ts", { withTimezone: true }).primaryKey().defaultNow(),
  stats: jsonb("stats").notNull(),
});
