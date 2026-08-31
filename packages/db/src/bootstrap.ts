/**
 * One-time environment bootstrap:
 *   - mints an `admin`-scoped API key for the dashboard server (if none exists)
 *   - seeds the first dashboard operator from ADMIN_BOOTSTRAP_USER / _PASSWORD
 *
 * Safe to re-run: it never creates duplicates and never prints an existing secret.
 */
import { hash as argon2Hash } from "@node-rs/argon2";
import { loadEnv } from "@xrpl-indexer/core/config";
import { eq, sql as raw } from "drizzle-orm";
import { createDb } from "./client.ts";
import { createKey } from "./authKeys.ts";
import { adminUser, apiKey } from "./schema/ops.ts";

loadEnv();

const { db, sql } = createDb({ max: 1 });

try {
  const existingAdminKey = await db
    .select({ id: apiKey.id })
    .from(apiKey)
    .where(raw`${apiKey.scopes} @> ARRAY['admin']::text[] and ${apiKey.revokedAt} is null`)
    .limit(1);

  if (existingAdminKey.length > 0) {
    process.stdout.write("admin API key already exists — leaving it alone\n");
  } else {
    const { plaintext } = await createKey(db, {
      label: "dashboard-admin (bootstrap)",
      scopes: ["admin", "nfts", "tokens", "amm", "vaults", "oracles"],
      rateLimit: 6000,
    });
    process.stdout.write(
      `\nAdmin API key (set as XRPL_API_ADMIN_KEY in the dashboard env, shown once):\n  ${plaintext}\n\n`,
    );
  }

  const username = process.env.ADMIN_BOOTSTRAP_USER;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (username && password) {
    const existing = await db
      .select({ id: adminUser.id })
      .from(adminUser)
      .where(eq(adminUser.username, username))
      .limit(1);
    if (existing.length > 0) {
      process.stdout.write(`operator "${username}" already exists — leaving it alone\n`);
    } else {
      const passwordHash = await argon2Hash(password);
      await db.insert(adminUser).values({ username, passwordHash });
      process.stdout.write(`seeded dashboard operator "${username}"\n`);
    }
  } else {
    process.stdout.write(
      "ADMIN_BOOTSTRAP_USER / ADMIN_BOOTSTRAP_PASSWORD not set — skipping operator seed\n",
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
