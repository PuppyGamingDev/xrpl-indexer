export * from "./config.ts";
export * from "./logger.ts";
export * from "./errors.ts";

/** XRPL asset-class discriminator used throughout the schema and API. */
export type TokenType = "XRP" | "IOU" | "MPT";

/** A resolved on-ledger asset reference. XRP has no issuer. */
export interface AssetRef {
  currency: string;
  issuer: string | null;
}

/** Metadata-source attribution stored on every enrichment row. */
export type MetaSource = "uri" | "bithomp" | "xrplto" | "xrplmeta" | "toml";
