import "server-only";
import { verify } from "@node-rs/argon2";
import { createDb, schema, sql } from "@xrpl-indexer/db";

const { adminUser } = schema;

let dbHandle: ReturnType<typeof createDb> | undefined;
function db() {
  dbHandle ??= createDb({ max: 3 });
  return dbHandle.db;
}

export interface Operator {
  id: number;
  username: string;
}

export async function verifyOperator(username: string, password: string): Promise<Operator | null> {
  if (!username || !password) return null;
  const [row] = await db()
    .select({ id: adminUser.id, username: adminUser.username, hash: adminUser.passwordHash })
    .from(adminUser)
    .where(sql`${adminUser.username} = ${username}`)
    .limit(1);
  if (!row) return null;

  const ok = await verify(row.hash, password).catch(() => false);
  if (!ok) return null;

  await db().update(adminUser).set({ lastLoginAt: new Date() }).where(sql`${adminUser.id} = ${row.id}`);
  return { id: row.id, username: row.username };
}
