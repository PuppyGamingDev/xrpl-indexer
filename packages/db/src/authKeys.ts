import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client.ts";
import { apiKey } from "./schema/ops.ts";

const KEY_BYTES = 24; // -> 32 base64url chars
const PREFIX_LEN = 8;

export interface GeneratedKey {
  /** Full secret. Returned once, never stored. */
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateKey(): GeneratedKey {
  const plaintext = randomBytes(KEY_BYTES).toString("base64url");
  return { plaintext, keyHash: sha256Hex(plaintext), keyPrefix: plaintext.slice(0, PREFIX_LEN) };
}

export interface AuthedKey {
  id: number;
  label: string;
  scopes: string[];
  rateLimit: number;
}

/** Look up a plaintext key; returns null if unknown or revoked. Touches lastUsedAt. */
export async function verifyKey(db: Db, plaintext: string): Promise<AuthedKey | null> {
  const hash = sha256Hex(plaintext);
  const row = await db.query.apiKey.findFirst({
    where: and(eq(apiKey.keyHash, hash), isNull(apiKey.revokedAt)),
  });
  if (!row) return null;
  // constant-time re-check against the row we found
  const a = Buffer.from(hash);
  const b = Buffer.from(row.keyHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  void db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, row.id))
    .catch(() => {});

  return { id: row.id, label: row.label, scopes: row.scopes, rateLimit: row.rateLimit };
}

export async function createKey(
  db: Db,
  opts: { label: string; scopes: string[]; rateLimit?: number },
): Promise<{ id: number; plaintext: string; keyPrefix: string }> {
  const g = generateKey();
  const [row] = await db
    .insert(apiKey)
    .values({
      label: opts.label,
      keyHash: g.keyHash,
      keyPrefix: g.keyPrefix,
      scopes: opts.scopes,
      rateLimit: opts.rateLimit ?? 120,
    })
    .returning({ id: apiKey.id });
  return { id: row!.id, plaintext: g.plaintext, keyPrefix: g.keyPrefix };
}

export async function revokeKey(db: Db, id: number): Promise<void> {
  await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, id));
}
