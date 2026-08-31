import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import { fetchNftMetadata } from "@xrpl-indexer/sources";
import type { EnrichContext } from "../context.ts";

const { nftMeta } = schema;
const log = createLogger("enrich.nft-metadata");

/** Fetch + parse one NFT's metadata JSON and upsert canonical links (no media download). */
export async function handleNftMetadata(
  data: JobPayloads["nft.metadata"],
  ctx: EnrichContext,
): Promise<void> {
  const nftTokenId = data.nftTokenId.toUpperCase();
  if (!data.uri) {
    await upsertError(ctx, nftTokenId, "no on-chain URI");
    return;
  }

  try {
    const m = await fetchNftMetadata(data.uri, {
      ipfsGateways: ctx.gateways.ipfsGateways,
      arweaveGateway: ctx.gateways.arweaveGateway,
      rotation: Math.floor(Math.random() * ctx.gateways.ipfsGateways.length),
    });
    await ctx.db
      .insert(nftMeta)
      .values({
        nftTokenId,
        name: m.name,
        description: m.description,
        imageUri: m.imageUri,
        mediaUri: m.mediaUri,
        mediaType: m.mediaType,
        attributes: m.attributes ?? null,
        collectionName: m.collectionName,
        source: "uri",
        error: null,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: nftMeta.nftTokenId,
        set: {
          // don't regress good data on a partial re-fetch
          name: sql`coalesce(excluded.name, ${nftMeta.name})`,
          description: sql`coalesce(excluded.description, ${nftMeta.description})`,
          imageUri: sql`coalesce(excluded.image_uri, ${nftMeta.imageUri})`,
          mediaUri: sql`coalesce(excluded.media_uri, ${nftMeta.mediaUri})`,
          mediaType: sql`excluded.media_type`,
          attributes: sql`coalesce(excluded.attributes, ${nftMeta.attributes})`,
          collectionName: sql`coalesce(excluded.collection_name, ${nftMeta.collectionName})`,
          source: sql`excluded.source`,
          error: sql`null`,
          fetchedAt: sql`now()`,
        },
      });
  } catch (err) {
    log.debug({ err, nftTokenId }, "nft metadata fetch failed");
    await upsertError(ctx, nftTokenId, (err as Error).message.slice(0, 200));
  }
}

async function upsertError(ctx: EnrichContext, nftTokenId: string, message: string): Promise<void> {
  await ctx.db
    .insert(nftMeta)
    .values({ nftTokenId, source: "uri", error: message, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: nftMeta.nftTokenId,
      set: { error: sql`excluded.error`, fetchedAt: sql`now()` },
    });
}
