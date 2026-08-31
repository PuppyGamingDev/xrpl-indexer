export * from "./client.ts";
export * as schema from "./schema/index.ts";
export * from "./authKeys.ts";
// NOTE: operator verification (pulls in @node-rs/argon2) is NOT re-exported here
// on purpose — import it from "@xrpl-indexer/db/operators" so services that
// don't need it (indexer, worker, backfiller) never load argon2.

// Re-export drizzle-orm operators so app code has one import site.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
