import { createDb, type Db } from "@xrpl-indexer/db";
import { config } from "./config.ts";

let db: Db | undefined;
let close: (() => Promise<void>) | undefined;

export function getApiDb(): Db {
  if (!db) {
    process.env.SERVICE_NAME = "xrpl-api";
    const created = createDb({ url: config.DATABASE_URL, max: config.API_DB_POOL, statementTimeoutMs: 30_000 });
    db = created.db;
    close = () => created.sql.end({ timeout: 5 });
  }
  return db;
}

export async function closeApiDb(): Promise<void> {
  await close?.();
  db = undefined;
  close = undefined;
}
