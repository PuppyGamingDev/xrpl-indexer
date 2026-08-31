import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export type Db = PostgresJsDatabase<typeof schema>;

let _sql: postgres.Sql | undefined;
let _db: Db | undefined;

export interface CreateDbOptions {
  url?: string;
  /** postgres.js pool size. Indexer stays small; API can go higher. */
  max?: number;
  /** Statement timeout in ms applied to every connection. */
  statementTimeoutMs?: number;
}

/** Create a fresh pool + Drizzle instance (does not touch the singleton). */
export function createDb(opts: CreateDbOptions = {}): { db: Db; sql: postgres.Sql } {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, {
    max: opts.max ?? 10,
    prepare: true,
    connection: {
      statement_timeout: opts.statementTimeoutMs ?? 30_000,
      application_name: process.env.SERVICE_NAME ?? "xrpl-indexer",
    },
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}

/** Process-wide singleton, created on first use from env. */
export function getDb(): Db {
  if (!_db) {
    const { db, sql } = createDb();
    _db = db;
    _sql = sql;
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  await _sql?.end({ timeout: 5 });
  _sql = undefined;
  _db = undefined;
}

export { schema };
