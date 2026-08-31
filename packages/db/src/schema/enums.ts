import { pgEnum } from "drizzle-orm/pg-core";

export const tokenType = pgEnum("token_type", ["XRP", "IOU", "MPT"]);
export const gapState = pgEnum("gap_state", ["pending", "running", "done"]);
export const metaSource = pgEnum("meta_source", ["uri", "bithomp", "xrplto", "xrplmeta", "toml"]);
