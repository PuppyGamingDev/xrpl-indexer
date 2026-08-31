import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { adminUser } from "./schema/ops.ts";

export interface Operator {
  id: number;
  username: string;
}

/** Verify a dashboard operator's password against `admin_user` (argon2id). */
export async function verifyOperator(
  db: Db,
  username: string,
  password: string,
): Promise<Operator | null> {
  if (!username || !password) return null;
  const [row] = await db
    .select({ id: adminUser.id, username: adminUser.username, hash: adminUser.passwordHash })
    .from(adminUser)
    .where(eq(adminUser.username, username))
    .limit(1);
  if (!row) return null;

  const ok = await argon2Verify(row.hash, password).catch(() => false);
  if (!ok) return null;

  await db
    .update(adminUser)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUser.id, row.id))
    .catch(() => {});
  return { id: row.id, username: row.username };
}

export { argon2Hash };
