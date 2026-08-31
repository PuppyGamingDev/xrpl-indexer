import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnv } from "@xrpl-indexer/core/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.ts";

loadEnv();

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const { db, sql } = createDb({ max: 1 });

try {
  await migrate(db, { migrationsFolder });
  process.stdout.write("migrations applied\n");
} finally {
  await sql.end({ timeout: 5 });
}
