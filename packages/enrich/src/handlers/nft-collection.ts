import { parseNftId } from "@xrpl-indexer/codec";
import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "../context.ts";

const { account, nft, nftCollection, nftMeta, nftCollectionStats, issuerCatalog } = schema;
const log = createLogger("enrich.nft-collection");

/**
 * Pull a whole issuer's NFT catalog from Bithomp in bulk (all taxa, live +
 * burned) and upsert `nft` stubs + `nft_meta`. This is the primary NFT
 * enrichment path — one job covers every NFT the issuer ever minted, including
 * ones minted and burned before our indexed ledger range. No-ops when no
 * NFT-catalog provider is configured (no Bithomp key).
 */
export async function handleNftCollection(
  data: JobPayloads["nft.collection"],
  ctx: EnrichContext,
): Promise<void> {
  const provider = ctx.providers.nftCatalog[0];
  if (!provider) return;

  const issuerId = await ensureAccount(ctx, data.issuer);
  if (issuerId == null) {
    log.warn({ issuer: data.issuer }, "issuer account not found; skipping");
    return;
  }

  const collByTaxon = new Map<number, number>();
  const nameByTaxon = new Map<number, string>();
  let count = 0;
  let burned = 0;

  for await (const n of provider.fetchIssuerNfts(data.issuer, { includeBurned: true })) {
    let parsed;
    try {
      parsed = parseNftId(n.nftTokenId);
    } catch {
      continue;
    }
    const taxon = parsed.taxon;

    let collectionId = collByTaxon.get(taxon);
    if (collectionId === undefined) {
      collectionId = await ensureCollection(ctx, issuerId, taxon);
      collByTaxon.set(taxon, collectionId);
    }
    if (n.collectionName && !nameByTaxon.has(taxon)) nameByTaxon.set(taxon, n.collectionName);

    // NFT stub — never regress rows the indexer wrote from on-ledger data.
    await ctx.db
      .insert(nft)
      .values({
        tokenId: n.nftTokenId,
        issuerId,
        collectionId,
        taxon,
        serial: parsed.sequence,
        flags: parsed.flags,
        transferFee: parsed.transferFee,
        uri: n.uri,
        mintLedgerSeq: null,
        burnLedgerSeq: n.burnLedger,
        live: !n.burned,
      })
      .onConflictDoNothing({ target: nft.tokenId });

    await ctx.db
      .insert(nftMeta)
      .values({
        nftTokenId: n.nftTokenId,
        name: n.name,
        description: n.description,
        imageUri: n.imageUri,
        mediaUri: n.mediaUri,
        mediaType: n.mediaType,
        attributes: n.attributes ?? null,
        collectionName: n.collectionName,
        source: "bithomp",
        error: null,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: nftMeta.nftTokenId,
        set: {
          name: sql`coalesce(excluded.name, ${nftMeta.name})`,
          description: sql`coalesce(excluded.description, ${nftMeta.description})`,
          imageUri: sql`coalesce(excluded.image_uri, ${nftMeta.imageUri})`,
          mediaUri: sql`coalesce(excluded.media_uri, ${nftMeta.mediaUri})`,
          mediaType: sql`coalesce(excluded.media_type, ${nftMeta.mediaType})`,
          attributes: sql`coalesce(excluded.attributes, ${nftMeta.attributes})`,
          collectionName: sql`coalesce(excluded.collection_name, ${nftMeta.collectionName})`,
          source: sql`excluded.source`,
          error: sql`null`,
          fetchedAt: sql`now()`,
        },
      });

    count++;
    if (n.burned) burned++;
  }

  for (const [taxon, name] of nameByTaxon) {
    const collectionId = collByTaxon.get(taxon);
    if (collectionId === undefined) continue;
    await ctx.db
      .insert(nftCollectionStats)
      .values({ collectionId, name })
      .onConflictDoUpdate({
        target: nftCollectionStats.collectionId,
        set: { name: sql`coalesce(${nftCollectionStats.name}, excluded.name)` },
      });
  }

  await ctx.db
    .insert(issuerCatalog)
    .values({ issuerId, nftCount: count })
    .onConflictDoUpdate({
      target: issuerCatalog.issuerId,
      set: { pulledAt: sql`now()`, nftCount: count },
    });

  log.info({ issuer: data.issuer, taxa: collByTaxon.size, count, burned }, "issuer catalog pulled");
}

async function ensureAccount(ctx: EnrichContext, address: string): Promise<number | null> {
  await ctx.db.execute(sql`
    insert into ${account} (address, first_seen_ledger) values (${address}, 0)
    on conflict (address) do nothing
  `);
  const [row] = await ctx.db.execute<{ id: number }>(
    sql`select id from ${account} where address = ${address}`,
  );
  return row ? Number(row.id) : null;
}

async function ensureCollection(
  ctx: EnrichContext,
  issuerId: number,
  taxon: number,
): Promise<number> {
  // first_seen_ledger 0 = "discovered off-ledger"; the indexer's real value wins
  // if it inserts the row first (both sides use conflict-do-nothing).
  await ctx.db.execute(sql`
    insert into ${nftCollection} (issuer_id, taxon, first_seen_ledger)
    values (${issuerId}, ${taxon}, 0)
    on conflict (issuer_id, taxon) do nothing
  `);
  const [row] = await ctx.db.execute<{ id: number }>(sql`
    select id from ${nftCollection} where issuer_id = ${issuerId} and taxon = ${taxon}
  `);
  return Number(row!.id);
}
