import { createLogger } from "@xrpl-indexer/core/logger";
import { parseNftId } from "@xrpl-indexer/codec";
import { schema, sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "../context.ts";

const { nftMeta, nftCollectionStats } = schema;
const log = createLogger("enrich.nft-collection");

/**
 * Pull a whole issuer catalog from a provider (Bithomp) and upsert metadata for
 * the NFTs that belong to this collection's taxon. No-ops when no NFT-catalog
 * provider is configured (e.g. no Bithomp key).
 */
export async function handleNftCollection(
  data: JobPayloads["nft.collection"],
  ctx: EnrichContext,
): Promise<void> {
  if (ctx.providers.nftCatalog.length === 0) return;
  const provider = ctx.providers.nftCatalog[0]!;

  let matched = 0;
  let firstName: string | null = null;
  for await (const nft of provider.fetchIssuerNfts(data.issuer)) {
    let taxon: number;
    try {
      taxon = parseNftId(nft.nftTokenId).taxon;
    } catch {
      continue;
    }
    if (taxon !== data.taxon) continue;
    matched++;
    firstName ??= nft.collectionName;

    await ctx.db
      .insert(nftMeta)
      .values({
        nftTokenId: nft.nftTokenId,
        name: nft.name,
        description: nft.description,
        imageUri: nft.imageUri,
        mediaUri: nft.mediaUri,
        mediaType: nft.mediaType,
        attributes: nft.attributes ?? null,
        collectionName: nft.collectionName,
        source: "bithomp",
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: nftMeta.nftTokenId,
        set: {
          name: sql`coalesce(excluded.name, ${nftMeta.name})`,
          imageUri: sql`coalesce(excluded.image_uri, ${nftMeta.imageUri})`,
          mediaUri: sql`coalesce(excluded.media_uri, ${nftMeta.mediaUri})`,
          attributes: sql`coalesce(excluded.attributes, ${nftMeta.attributes})`,
          collectionName: sql`coalesce(excluded.collection_name, ${nftMeta.collectionName})`,
          fetchedAt: sql`now()`,
        },
      });
  }

  if (firstName) {
    await ctx.db
      .insert(nftCollectionStats)
      .values({ collectionId: data.collectionId, name: firstName })
      .onConflictDoUpdate({
        target: nftCollectionStats.collectionId,
        set: { name: sql`coalesce(${nftCollectionStats.name}, excluded.name)` },
      });
  }
  log.info({ issuer: data.issuer, taxon: data.taxon, matched }, "collection catalog pulled");
}
