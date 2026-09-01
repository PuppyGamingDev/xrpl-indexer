import { createLogger } from "@xrpl-indexer/core/logger";
import { sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "./context.ts";

const log = createLogger("enrich.discovery");

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
  /** Don't re-pull a whole issuer catalog more often than this. */
  recatalogAfterHours?: number;
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
  const recatalogH = opts.recatalogAfterHours ?? 12;
  const hasCatalog = ctx.providers.nftCatalog.length > 0;

  if (kinds.includes("nft") && hasCatalog) {
    // Primary path: one bulk Bithomp catalog pull per issuer that has NFTs
    // still missing metadata AND hasn't been pulled recently (so we don't
    // re-stream a whole catalog every scan just because Bithomp genuinely lacks
    // a few of its NFTs). `stately` + key `issuer:<addr>` bounds it further.
    const rows = await ctx.db.execute<{ issuer: string; missing: number }>(sql`
      select a.address as issuer, count(*) as missing
      from nft n
      join account a on a.id = n.issuer_id
      left join nft_meta m on m.nft_token_id = n.token_id
      where (m.nft_token_id is null
             or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
        and not exists (
          select 1 from issuer_catalog ic
          where ic.issuer_id = n.issuer_id
            and ic.pulled_at > now() - (${recatalogH} || ' hours')::interval
        )
      group by a.address
      order by missing desc
      limit ${issuerBatch}
    `);
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
    const rows = await ctx.db.execute<{ token_id: string; uri: string }>(sql`
      select n.token_id, n.uri
      from nft n
      left join nft_meta m on m.nft_token_id = n.token_id
      where n.uri is not null and n.live
        and (m.nft_token_id is null
             or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
        ${catalogGate}
      limit ${nftBatch}
    `);
    await ctx.jobs.enqueueMany(
      "nft.metadata",
      rows.map((r) => ({ data: { nftTokenId: r.token_id, uri: r.uri }, key: `nft:${r.token_id}` })),
    );
    log.info({ enqueued: rows.length }, "nft.metadata fallback discovery");
  }

  if (kinds.includes("token")) {
    // Fallback for tokens xrplmeta's bulk `token.catalog` didn't cover. The
    // handler writes an error row on a miss, so these stop recurring.
    const rows = await ctx.db.execute<{ id: number }>(sql`
      select t.id from token t
      left join token_meta m on m.token_id = t.id
      where t.token_type <> 'XRP'
        and (m.token_id is null
             or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
      limit ${tokenBatch}
    `);
    await ctx.jobs.enqueueMany(
      "token.metadata",
      rows.map((r) => ({ data: { tokenId: r.id }, key: `token:${r.id}` })),
    );
    log.info({ enqueued: rows.length }, "token.metadata fallback discovery");
  }
}
