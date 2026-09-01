import { createLogger } from "@xrpl-indexer/core/logger";
import { sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "./context.ts";

const log = createLogger("enrich.discovery");

type SqlQuery = ReturnType<typeof sql>;

export interface DiscoveryOptions {
  /** Max issuers to enqueue a full bulk catalog pull for per scan. */
  issuerBatch?: number;
  /** Max per-NFT fallback jobs per scan (only for issuers already bulk-pulled). */
  nftBatch?: number;
  /** Max per-token fallback jobs per scan. */
  tokenBatch?: number;
  /** Re-attempt error rows older than this many hours. */
  retryErrorsAfterHours?: number;
  /** Only run the per-NFT fallback for issuers pulled more than this many hours ago. */
  catalogGraceHours?: number;
  /** Don't re-pull a whole issuer catalog more often than this (default 72h). */
  recatalogAfterHours?: number;
}

/**
 * Run a discovery scan query with the per-connection `statement_timeout` lifted
 * — these are background batch scans over `nft` / `token`, not web requests, and
 * the default 30s cap trips on large tables.
 */
async function scan<T extends Record<string, unknown>>(
  ctx: EnrichContext,
  query: SqlQuery,
): Promise<T[]> {
  return ctx.db.transaction(async (tx) => {
    // Bounded — generous for a batch scan, but a pathological plan must abort,
    // not run for 30 min and let the next cron fire stack behind it.
    await tx.execute(sql`set local statement_timeout = '120s'`);
    // No gain from parallel workers on a LIMIT scan; they also allocate DSM in
    // the container's small /dev/shm.
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    return (await tx.execute<T>(query)) as unknown as T[];
  });
}

/** Scan for un-enriched rows and enqueue metadata jobs. Idempotent via `stately` singleton keys. */
export async function runDiscovery(
  ctx: EnrichContext,
  kinds: NonNullable<JobPayloads["discovery.scan"]["kinds"]> = ["nft", "token", "issuer"],
  opts: DiscoveryOptions = {},
): Promise<void> {
  const issuerBatch = opts.issuerBatch ?? 100;
  const nftBatch = opts.nftBatch ?? 500;
  const tokenBatch = opts.tokenBatch ?? 200;
  const retryH = opts.retryErrorsAfterHours ?? 24;
  const graceH = opts.catalogGraceHours ?? 1;
  const recatalogH = opts.recatalogAfterHours ?? 72;
  const hasCatalog = ctx.providers.nftCatalog.length > 0;

  if (kinds.includes("nft") && hasCatalog) {
    // Primary path: bulk Bithomp catalog pull per NFT-issuing account not pulled
    // in the last `recatalogH` hours. Deliberately does NOT check per-NFT
    // metadata coverage — that's an anti-join over millions of `nft` rows per
    // scan; `issuer_catalog` recency is the throttle, and each pull re-covers
    // the whole issuer (new mints, changed metadata, burns) anyway.
    const rows = await scan<{ issuer: string }>(
      ctx,
      sql`
        select a.address as issuer
        from account a
        where exists (select 1 from nft n where n.issuer_id = a.id)
          and not exists (
            select 1 from issuer_catalog ic
            where ic.issuer_id = a.id
              and ic.pulled_at > now() - (${recatalogH} || ' hours')::interval
          )
        limit ${issuerBatch}
      `,
    );
    await ctx.jobs.enqueueMany(
      "nft.collection",
      rows.map((r) => ({ data: { issuer: r.issuer }, key: `issuer:${r.issuer}` })),
    );
    log.info({ enqueued: rows.length }, "nft.collection discovery");
  }

  if (kinds.includes("nft")) {
    // Long-tail fallback: per-NFT IPFS fetch, but only for NFTs whose issuer was
    // already bulk-pulled (or when there's no Bithomp catalog at all) and still
    // has no metadata.
    const catalogGate = hasCatalog
      ? sql`and exists (
          select 1 from issuer_catalog ic
          where ic.issuer_id = n.issuer_id and ic.pulled_at < now() - (${graceH} || ' hours')::interval
        )`
      : sql``;
    const rows = await scan<{ token_id: string; uri: string }>(
      ctx,
      sql`
        select n.token_id, n.uri
        from nft n
        left join nft_meta m on m.nft_token_id = n.token_id
        where n.uri is not null and n.live
          and (m.nft_token_id is null
               or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
          ${catalogGate}
        limit ${nftBatch}
      `,
    );
    await ctx.jobs.enqueueMany(
      "nft.metadata",
      rows.map((r) => ({ data: { nftTokenId: r.token_id, uri: r.uri }, key: `nft:${r.token_id}` })),
    );
    log.info({ enqueued: rows.length }, "nft.metadata fallback discovery");
  }

  if (kinds.includes("token")) {
    // Fallback for tokens xrplmeta's bulk `token.catalog` didn't cover. The
    // handler writes an error row on a miss, so these stop recurring.
    const rows = await scan<{ id: number }>(
      ctx,
      sql`
        select t.id from token t
        left join token_meta m on m.token_id = t.id
        where t.token_type <> 'XRP'
          and (m.token_id is null
               or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
        limit ${tokenBatch}
      `,
    );
    await ctx.jobs.enqueueMany(
      "token.metadata",
      rows.map((r) => ({ data: { tokenId: r.id }, key: `token:${r.id}` })),
    );
    log.info({ enqueued: rows.length }, "token.metadata fallback discovery");
  }
}
