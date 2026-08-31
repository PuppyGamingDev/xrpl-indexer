import { createLogger } from "@xrpl-indexer/core/logger";
import { sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "./context.ts";

const log = createLogger("enrich.discovery");

export interface DiscoveryOptions {
  nftBatch?: number;
  tokenBatch?: number;
  collectionBatch?: number;
  /** Re-attempt error rows older than this many hours. */
  retryErrorsAfterHours?: number;
}

/** Scan for un-enriched rows and enqueue metadata jobs. Idempotent via singleton keys. */
export async function runDiscovery(
  ctx: EnrichContext,
  kinds: NonNullable<JobPayloads["discovery.scan"]["kinds"]> = ["nft", "token", "issuer"],
  opts: DiscoveryOptions = {},
): Promise<void> {
  const nftBatch = opts.nftBatch ?? 2000;
  const tokenBatch = opts.tokenBatch ?? 500;
  const collectionBatch = opts.collectionBatch ?? 200;
  const retryH = opts.retryErrorsAfterHours ?? 24;

  if (kinds.includes("nft")) {
    const rows = await ctx.db.execute<{ token_id: string; uri: string }>(sql`
      select n.token_id, n.uri
      from nft n
      left join nft_meta m on m.nft_token_id = n.token_id
      where n.uri is not null and n.live
        and (m.nft_token_id is null
             or (m.error is not null and m.fetched_at < now() - (${retryH} || ' hours')::interval))
      limit ${nftBatch}
    `);
    await ctx.jobs.enqueueMany(
      "nft.metadata",
      rows.map((r) => ({ data: { nftTokenId: r.token_id, uri: r.uri }, key: `nft:${r.token_id}` })),
    );
    log.info({ enqueued: rows.length }, "nft.metadata discovery");
  }

  if (kinds.includes("token")) {
    const rows = await ctx.db.execute<{ id: number }>(sql`
      select t.id from token t
      left join token_meta m on m.token_id = t.id
      where t.token_type <> 'XRP' and m.token_id is null
      limit ${tokenBatch}
    `);
    await ctx.jobs.enqueueMany(
      "token.metadata",
      rows.map((r) => ({ data: { tokenId: r.id }, key: `token:${r.id}` })),
    );
    log.info({ enqueued: rows.length }, "token.metadata discovery");
  }

  if (kinds.includes("issuer") && ctx.providers.nftCatalog.length > 0) {
    const rows = await ctx.db.execute<{ id: number; issuer: string; taxon: number }>(sql`
      select c.id, a.address as issuer, c.taxon
      from nft_collection c
      join account a on a.id = c.issuer_id
      left join nft_collection_stats cs on cs.collection_id = c.id
      where cs.name is null
      limit ${collectionBatch}
    `);
    await ctx.jobs.enqueueMany(
      "nft.collection",
      rows.map((r) => ({
        data: { collectionId: r.id, issuer: r.issuer, taxon: Number(r.taxon) },
        key: `col:${r.id}`,
      })),
    );
    log.info({ enqueued: rows.length }, "nft.collection discovery");
  }
}
