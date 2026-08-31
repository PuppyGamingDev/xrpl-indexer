import { createKey, type Db, revokeKey, schema, sql } from "@xrpl-indexer/db";

const { apiKey } = schema;

export async function listApiKeys(db: Db): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select id, label, key_prefix, scopes, rate_limit,
           created_at, last_used_at, revoked_at
    from api_key order by created_at desc
  `);
  return [...rows];
}

export async function createApiKey(
  db: Db,
  input: { label: string; scopes: string[]; rateLimit?: number },
): Promise<{ id: number; key: string; keyPrefix: string }> {
  const { id, plaintext, keyPrefix } = await createKey(db, input);
  return { id, key: plaintext, keyPrefix };
}

export async function revokeApiKey(db: Db, id: number): Promise<void> {
  await revokeKey(db, id);
}

export async function patchApiKey(
  db: Db,
  id: number,
  patch: { scopes?: string[]; rateLimit?: number },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.scopes) set.scopes = patch.scopes;
  if (patch.rateLimit !== undefined) set.rateLimit = patch.rateLimit;
  if (Object.keys(set).length === 0) return;
  await db.update(apiKey).set(set).where(sql`${apiKey.id} = ${id}`);
}
