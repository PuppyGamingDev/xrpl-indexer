import type { TokenType } from "@xrpl-indexer/core";
import { and, type Db, eq, inArray, schema, sql } from "@xrpl-indexer/db";

const { account, token, nftCollection } = schema;

/**
 * Read-through cache that maps XRPL identifiers to our surrogate integer ids,
 * creating rows on first sight. One instance per indexer process; the caches
 * are monotonic (ids never change) so they are safe to keep for the lifetime
 * of the process.
 */
export class Registry {
  private readonly accounts = new Map<string, number>();
  private readonly tokens = new Map<string, number>();
  private readonly collections = new Map<string, number>();
  /** account ids known to be AMM/Vault pseudo-accounts. */
  private readonly pseudo = new Set<number>();

  constructor(private readonly db: Db) {}

  /** Load the pseudo-account set once at startup (used to keep tracking their XRP reserves). */
  async init(): Promise<void> {
    const rows = await this.db.execute<{ id: number }>(sql`select id from account where pseudo = true`);
    for (const r of rows) this.pseudo.add(r.id);
  }

  markPseudo(accountId: number): void {
    this.pseudo.add(accountId);
  }

  isPseudo(accountId: number): boolean {
    return this.pseudo.has(accountId);
  }

  async collectionId(issuerId: number, taxon: number, firstSeenLedger: number): Promise<number> {
    const key = `${issuerId}:${taxon}`;
    const hit = this.collections.get(key);
    if (hit !== undefined) return hit;
    const [row] = await this.db
      .insert(nftCollection)
      .values({ issuerId, taxon, firstSeenLedger })
      .onConflictDoUpdate({
        target: [nftCollection.issuerId, nftCollection.taxon],
        set: { firstSeenLedger: sql`least(${nftCollection.firstSeenLedger}, excluded.first_seen_ledger)` },
      })
      .returning({ id: nftCollection.id });
    this.collections.set(key, row!.id);
    return row!.id;
  }

  async accountId(address: string, firstSeenLedger: number): Promise<number> {
    const hit = this.accounts.get(address);
    if (hit !== undefined) return hit;
    const [row] = await this.db
      .insert(account)
      .values({ address, firstSeenLedger })
      .onConflictDoUpdate({ target: account.address, set: { address } })
      .returning({ id: account.id });
    this.accounts.set(address, row!.id);
    return row!.id;
  }

  /**
   * Resolve a batch of addresses in two round-trips (insert-missing + select),
   * populating the cache. After this, `accountId()` for these is a cache hit.
   * Used by the snapshot to avoid one round-trip per ledger entry.
   */
  async bulkEnsureAccounts(addresses: Iterable<string>, firstSeenLedger: number): Promise<void> {
    const missing = [...new Set(addresses)].filter((a) => a && !this.accounts.has(a)).sort();
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += 5000) {
      const chunk = missing.slice(i, i + 5000);
      await this.db
        .insert(account)
        .values(chunk.map((address) => ({ address, firstSeenLedger })))
        .onConflictDoNothing();
      const rows = await this.db
        .select({ id: account.id, address: account.address })
        .from(account)
        .where(inArray(account.address, chunk));
      for (const r of rows) this.accounts.set(r.address, r.id);
    }
  }

  /** Synchronous cache read — undefined on miss. */
  cachedAccountId(address: string): number | undefined {
    return this.accounts.get(address);
  }

  /**
   * Bulk insert-missing + select for a batch of (currency, issuerId) IOU tokens,
   * populating the cache. Snapshot use — avoids one round-trip per trustline.
   */
  async bulkEnsureIouTokens(
    pairs: { currency: string; issuerId: number }[],
    firstSeenLedger: number,
  ): Promise<void> {
    const uniq = new Map<string, { currency: string; issuerId: number }>();
    for (const p of pairs) {
      const key = `IOU:${p.currency}:${p.issuerId}`;
      if (!this.tokens.has(key)) uniq.set(key, p);
    }
    if (uniq.size === 0) return;
    const rows = [...uniq.values()];
    for (let i = 0; i < rows.length; i += 5000) {
      const chunk = rows.slice(i, i + 5000);
      await this.db
        .insert(token)
        .values(chunk.map((p) => ({ tokenType: "IOU" as const, ...p, firstSeenLedger })))
        .onConflictDoNothing();
    }
    const issuerIds = [...new Set(rows.map((p) => p.issuerId))];
    const existing = await this.db
      .select({ id: token.id, currency: token.currency, issuerId: token.issuerId })
      .from(token)
      .where(and(eq(token.tokenType, "IOU"), inArray(token.issuerId, issuerIds)));
    for (const r of existing) {
      if (r.currency != null && r.issuerId != null) {
        this.tokens.set(`IOU:${r.currency}:${r.issuerId}`, r.id);
      }
    }
  }

  async xrpTokenId(firstSeenLedger: number): Promise<number> {
    return this.resolveToken("XRP", { tokenType: "XRP" }, firstSeenLedger);
  }

  async iouTokenId(
    currency: string,
    issuerId: number,
    firstSeenLedger: number,
  ): Promise<number> {
    return this.resolveToken(`IOU:${currency}:${issuerId}`, { tokenType: "IOU", currency, issuerId }, firstSeenLedger);
  }

  async mptTokenId(
    mptIssuanceId: string,
    issuerId: number,
    firstSeenLedger: number,
  ): Promise<number> {
    return this.resolveToken(
      `MPT:${mptIssuanceId}`,
      { tokenType: "MPT", mptIssuanceId, issuerId },
      firstSeenLedger,
    );
  }

  private async resolveToken(
    cacheKey: string,
    values: {
      tokenType: TokenType;
      currency?: string;
      issuerId?: number;
      mptIssuanceId?: string;
    },
    firstSeenLedger: number,
  ): Promise<number> {
    const hit = this.tokens.get(cacheKey);
    if (hit !== undefined) return hit;

    // Upsert against whichever partial unique index applies.
    const target =
      values.tokenType === "IOU"
        ? [token.currency, token.issuerId]
        : values.tokenType === "MPT"
          ? [token.mptIssuanceId]
          : [token.tokenType];

    const [row] = await this.db
      .insert(token)
      .values({ ...values, firstSeenLedger })
      .onConflictDoUpdate({
        target,
        targetWhere: sql`${token.tokenType} = ${values.tokenType}`,
        set: { firstSeenLedger: sql`least(${token.firstSeenLedger}, excluded.first_seen_ledger)` },
      })
      .returning({ id: token.id });

    if (row) {
      this.tokens.set(cacheKey, row.id);
      return row.id;
    }
    // Extremely unlikely fallthrough: read it back.
    const existing = await this.db.query.token.findFirst({
      where:
        values.tokenType === "IOU"
          ? sql`${token.tokenType} = 'IOU' and ${token.currency} = ${values.currency} and ${token.issuerId} = ${values.issuerId}`
          : values.tokenType === "MPT"
            ? eq(token.mptIssuanceId, values.mptIssuanceId!)
            : eq(token.tokenType, "XRP"),
    });
    if (!existing) throw new Error(`registry: could not resolve token ${cacheKey}`);
    this.tokens.set(cacheKey, existing.id);
    return existing.id;
  }
}
