import { type Db, schema, sql } from "@xrpl-indexer/db";

const {
  accountBalance,
  tokenExchange,
  nft,
  nftOffer,
  nftExchange,
  amm,
  vault,
  oracle,
  account,
  tokenHolders,
  tokenSupply,
  tokenTrustlines,
} = schema;

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/**
 * Accumulates every mutation derived from one ledger, then writes them in a
 * single transaction. Within a ledger, later writes for the same key win.
 */
export class LedgerBatch {
  readonly ledgerSeq: number;

  private readonly balances = new Map<string, Row<typeof accountBalance>>();
  private readonly tokenExchanges: Row<typeof tokenExchange>[] = [];
  private readonly nftUpserts = new Map<string, Row<typeof nft>>();
  private readonly nftOffers = new Map<string, Row<typeof nftOffer>>();
  private readonly nftExchanges: Row<typeof nftExchange>[] = [];
  private readonly amms = new Map<number, Row<typeof amm>>();
  private readonly vaults = new Map<string, Row<typeof vault>>();
  private readonly oracles = new Map<string, Row<typeof oracle>>();
  private readonly accountPatches = new Map<number, Partial<Row<typeof account>>>();

  /** Tokens whose holder set changed this ledger — recompute metric points on flush. */
  readonly touchedTokens = new Set<number>();

  /** The XRP token id — excluded from per-ledger holder/supply recompute (meaningless + huge). */
  private readonly xrpTokenId: number;

  constructor(ledgerSeq: number, opts: { xrpTokenId: number }) {
    this.ledgerSeq = ledgerSeq;
    this.xrpTokenId = opts.xrpTokenId;
  }

  balance(accountId: number, tokenId: number, balance: string): void {
    this.balances.set(`${accountId}:${tokenId}`, {
      accountId,
      tokenId,
      ledgerSeq: this.ledgerSeq,
      balance,
    });
    // XRP "holders/supply" over every account is not a useful metric and the
    // recompute would scan millions of rows every ledger.
    if (tokenId !== this.xrpTokenId) this.touchedTokens.add(tokenId);
  }

  patchAccount(accountId: number, patch: Partial<Row<typeof account>>): void {
    this.accountPatches.set(accountId, { ...this.accountPatches.get(accountId), ...patch });
  }

  tokenExchange(row: Row<typeof tokenExchange>): void {
    this.tokenExchanges.push(row);
  }

  nft(row: Row<typeof nft>): void {
    this.nftUpserts.set(row.tokenId, { ...this.nftUpserts.get(row.tokenId), ...row });
  }

  nftOffer(row: Row<typeof nftOffer>): void {
    this.nftOffers.set(row.offerId, { ...this.nftOffers.get(row.offerId), ...row });
  }

  nftExchange(row: Row<typeof nftExchange>): void {
    this.nftExchanges.push(row);
  }

  amm(row: Row<typeof amm>): void {
    this.amms.set(row.accountId, row);
  }

  vault(row: Row<typeof vault>): void {
    this.vaults.set(row.vaultId, row);
  }

  oracle(row: Row<typeof oracle>): void {
    this.oracles.set(row.oracleId, row);
  }

  isEmpty(): boolean {
    return (
      this.balances.size === 0 &&
      this.tokenExchanges.length === 0 &&
      this.nftUpserts.size === 0 &&
      this.nftOffers.size === 0 &&
      this.nftExchanges.length === 0 &&
      this.amms.size === 0 &&
      this.vaults.size === 0 &&
      this.oracles.size === 0 &&
      this.accountPatches.size === 0
    );
  }

  /** Persist everything. Must run inside a transaction (`tx`). */
  async flush(tx: Db): Promise<void> {
    if (this.balances.size) {
      await tx
        .insert(accountBalance)
        .values([...this.balances.values()])
        .onConflictDoUpdate({
          target: [accountBalance.accountId, accountBalance.tokenId, accountBalance.ledgerSeq],
          set: { balance: sql`excluded.balance` },
        });
    }

    for (const [accountId, patch] of this.accountPatches) {
      await tx.update(account).set(patch).where(sql`${account.id} = ${accountId}`);
    }

    if (this.nftUpserts.size) {
      await tx
        .insert(nft)
        .values([...this.nftUpserts.values()])
        .onConflictDoUpdate({
          target: nft.tokenId,
          set: {
            ownerId: sql`coalesce(excluded.owner_id, ${nft.ownerId})`,
            burnLedgerSeq: sql`coalesce(excluded.burn_ledger_seq, ${nft.burnLedgerSeq})`,
            // once burned, stays burned; a stub (excluded.live = true) never resurrects
            live: sql`${nft.live} and excluded.live`,
            uri: sql`coalesce(excluded.uri, ${nft.uri})`,
            mintLedgerSeq: sql`coalesce(${nft.mintLedgerSeq}, excluded.mint_ledger_seq)`,
            collectionId: sql`coalesce(excluded.collection_id, ${nft.collectionId})`,
          },
        });
    }

    if (this.nftOffers.size) {
      await tx
        .insert(nftOffer)
        .values([...this.nftOffers.values()])
        .onConflictDoUpdate({
          target: nftOffer.offerId,
          set: { closedLedgerSeq: sql`coalesce(excluded.closed_ledger_seq, ${nftOffer.closedLedgerSeq})` },
        });
    }

    if (this.nftExchanges.length) {
      await tx.insert(nftExchange).values(this.nftExchanges).onConflictDoNothing();
    }

    if (this.tokenExchanges.length) {
      await tx.insert(tokenExchange).values(this.tokenExchanges).onConflictDoNothing();
    }

    if (this.amms.size) {
      await tx
        .insert(amm)
        .values([...this.amms.values()])
        .onConflictDoUpdate({
          target: amm.accountId,
          set: { tradingFee: sql`excluded.trading_fee` },
        });
    }

    if (this.vaults.size) {
      await tx
        .insert(vault)
        .values([...this.vaults.values()])
        .onConflictDoUpdate({
          target: vault.vaultId,
          set: {
            assetsTotal: sql`excluded.assets_total`,
            assetsAvailable: sql`excluded.assets_available`,
            assetsMaximum: sql`excluded.assets_maximum`,
            flags: sql`excluded.flags`,
            ledgerSeq: sql`excluded.ledger_seq`,
          },
        });
    }

    if (this.oracles.size) {
      await tx
        .insert(oracle)
        .values([...this.oracles.values()])
        .onConflictDoUpdate({
          target: oracle.oracleId,
          set: {
            lastUpdateTime: sql`excluded.last_update_time`,
            priceDataCount: sql`excluded.price_data_count`,
            ledgerSeq: sql`excluded.ledger_seq`,
          },
        });
    }

    await this.writeMetricPoints(tx);
  }

  /**
   * For each touched token, recompute holders / trustlines / supply from the
   * current balance set and append a metric point only when the value moved.
   */
  private async writeMetricPoints(tx: Db): Promise<void> {
    for (const tokenId of this.touchedTokens) {
      const [agg] = await tx.execute<{
        holders: number;
        trustlines: number;
        supply: string;
      }>(sql`
        with latest as (
          select distinct on (account_id) account_id, balance
          from account_balance
          where token_id = ${tokenId}
          order by account_id, ledger_seq desc
        )
        select
          count(*) filter (where balance <> 0)::int         as trustlines,
          count(*) filter (where balance > 0)::int          as holders,
          coalesce(sum(balance) filter (where balance > 0), 0)::text as supply
        from latest
      `);
      if (!agg) continue;

      await appendMetricPoint(tx, tokenHolders, tokenId, this.ledgerSeq, String(agg.holders));
      await appendMetricPoint(tx, tokenTrustlines, tokenId, this.ledgerSeq, String(agg.trustlines));
      await appendMetricPoint(tx, tokenSupply, tokenId, this.ledgerSeq, agg.supply);
    }
  }
}

type MetricTable = typeof tokenHolders | typeof tokenSupply | typeof tokenTrustlines;

async function appendMetricPoint(
  tx: Db,
  table: MetricTable,
  tokenId: number,
  ledgerSeq: number,
  value: string,
): Promise<void> {
  const [prev] = await tx
    .select({ value: table.value })
    .from(table)
    .where(sql`${table.tokenId} = ${tokenId} and ${table.ledgerSeq} <= ${ledgerSeq}`)
    .orderBy(sql`${table.ledgerSeq} desc`)
    .limit(1);
  if (prev && String(prev.value) === value) return;
  await tx
    .insert(table)
    .values({ tokenId, ledgerSeq, value })
    .onConflictDoUpdate({
      target: [table.tokenId, table.ledgerSeq],
      set: { value: sql`excluded.value` },
    });
}
