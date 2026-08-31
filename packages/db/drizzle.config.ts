import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "postgres://xrpl:xrpl@localhost:5432/xrpl_indexer";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
