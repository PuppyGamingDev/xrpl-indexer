import { bigint, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** REST API credentials. Plaintext key is shown once at creation, then only `keyPrefix`. */
export const apiKey = pgTable("api_key", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  label: text("label").notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  /** First ~8 chars of the plaintext key — non-secret, for UI identification. */
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  /** e.g. {"nfts","tokens","amm","vaults","oracles","admin"} */
  scopes: text("scopes").array().notNull().default([]),
  /** Requests per 60s sliding window. */
  rateLimit: integer("rate_limit").notNull().default(120),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Dashboard operators (key-management UI login). */
export const adminUser = pgTable("admin_user", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  /** argon2id hash. */
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Server-side sessions for the dashboard admin area. */
export const adminSession = pgTable("admin_session", {
  id: varchar("id", { length: 36 }).primaryKey(),
  adminUserId: bigint("admin_user_id", { mode: "number" })
    .notNull()
    .references(() => adminUser.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
