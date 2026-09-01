import { NotFoundError } from "@xrpl-indexer/core/errors";
import { type Db, sql } from "@xrpl-indexer/db";
import { config } from "../config.ts";
import { type ListParams, orderDir, type Page } from "./common.ts";

function resolveGatewayUri(uri: string | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return `${config.API_DEFAULT_IPFS_GATEWAY}/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

export async function getNft(db: Db, tokenId: string): Promise<unknown> {
  const id = tokenId.toUpperCase();
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      n.token_id, n.taxon, n.serial, n.flags, n.transfer_fee, n.uri,
      n.mint_ledger_seq, n.burn_ledger_seq, n.live,
      iss.address as issuer, own.address as owner, n.collection_id,
      m.name, m.description, m.image_uri, m.media_uri, m.media_type, m.attributes, m.collection_name, m.source
    from nft n
    join account iss on iss.id = n.issuer_id
    left join account own on own.id = n.owner_id
    left join nft_meta m on m.nft_token_id = n.token_id
    where n.token_id = ${id}
  `);
  if (!row) throw new NotFoundError("NFT not found");

  const offers = await db.execute<Record<string, unknown>>(sql`
    select o.offer_id, acc.address as account, o.amount, o.is_sell,
           dst.address as destination, o.expiration, o.created_ledger_seq
    from nft_offer o
    join account acc on acc.id = o.account_id
    left join account dst on dst.id = o.destination_id
    where o.nft_token_id = ${id} and o.closed_ledger_seq is null
    order by o.created_ledger_seq desc
  `);

  return {
    tokenId: row.token_id,
    issuer: row.issuer,
    owner: row.owner,
    collection: row.collection_id,
    taxon: Number(row.taxon),
    serial: Number(row.serial),
    flags: Number(row.flags),
    transferFee: Number(row.transfer_fee),
    mintLedgerSequence: row.mint_ledger_seq,
    burnLedgerSequence: row.burn_ledger_seq,
    uri: row.uri,
    live: row.live,
    offers: [...offers],
    meta: row.name || row.image_uri
      ? {
          name: row.name,
          description: row.description,
          imageUri: row.image_uri,
          mediaUri: row.media_uri,
          mediaType: row.media_type,
          attributes: row.attributes ?? null,
          collectionName: row.collection_name,
          source: row.source,
        }
      : null,
  };
}

export async function getNftImage(db: Db, tokenId: string): Promise<unknown> {
  const [row] = await db.execute<{ image_uri: string | null; media_uri: string | null; media_type: string | null }>(sql`
    select image_uri, media_uri, media_type from nft_meta where nft_token_id = ${tokenId.toUpperCase()}
  `);
  const imageUri = row?.image_uri ?? null;
  const mediaUri = row?.media_uri ?? null;
  return {
    tokenId: tokenId.toUpperCase(),
    imageUri,
    mediaUri,
    mediaType: row?.media_type ?? null,
    resolved: { image: resolveGatewayUri(imageUri), media: resolveGatewayUri(mediaUri) },
  };
}

export const COLLECTION_SORTS = [
  "supply",
  "holders",
  "volume24h",
  "volume7d",
  "volumeAll",
  "trades24h",
  "trades7d",
  "age",
  "name",
] as const;

export interface ListCollectionsParams extends ListParams {
  /** matches nft_collection_stats.name or exact issuer address */
  search?: string;
  issuer?: string;
  namedOnly?: boolean;
}

export interface ListCollectionsResult extends ListParams {
  total: number;
  collections: Record<string, unknown>[];
}

export async function listCollections(db: Db, p: ListCollectionsParams): Promise<ListCollectionsResult> {
  const sortCol =
    p.sortBy === "holders"
      ? sql`coalesce(cs.holders, 0)`
      : p.sortBy === "volume24h"
        ? sql`coalesce(cs.volume_24h, 0)`
        : p.sortBy === "volume7d"
          ? sql`coalesce(cs.volume_7d, 0)`
          : p.sortBy === "volumeAll"
            ? sql`coalesce(cs.volume_all, 0)`
            : p.sortBy === "trades24h"
              ? sql`coalesce(cs.trades_24h, 0)`
              : p.sortBy === "trades7d"
                ? sql`coalesce(cs.trades_7d, 0)`
                : p.sortBy === "age"
                  ? sql`c.first_seen_ledger`
                  : p.sortBy === "name"
                    ? sql`lower(cs.name)`
                    : sql`coalesce(cs.supply, 0)`;

  const s = p.search?.trim();
  const rows = await db.execute<Record<string, unknown> & { total: number }>(sql`
    select
      c.id, iss.address as issuer, c.taxon, c.first_seen_ledger,
      cs.name, cs.image_uri,
      coalesce(cs.supply, 0)  as supply,
      coalesce(cs.holders, 0) as holders,
      cs.floor::text        as floor,
      cs.volume_24h::text   as volume_24h,
      cs.volume_7d::text    as volume_7d,
      cs.volume_all::text   as volume_all,
      cs.trades_24h, cs.trades_7d,
      (select count(*) from nft n where n.collection_id = c.id and n.live)::int as live_supply,
      count(*) over()::int as total
    from nft_collection c
    join account iss on iss.id = c.issuer_id
    left join nft_collection_stats cs on cs.collection_id = c.id
    where 1=1
      ${p.issuer ? sql`and iss.address = ${p.issuer}` : sql``}
      ${p.namedOnly ? sql`and cs.name is not null` : sql``}
      ${s ? sql`and (cs.name ilike ${"%" + s + "%"} or iss.address = ${s})` : sql``}
    order by ${sortCol} ${orderDir(p.order)}, c.id
    limit ${p.limit} offset ${p.offset}
  `);

  const list = [...rows];
  const total = list[0]?.total ?? 0;
  for (const r of list) delete (r as { total?: number }).total;
  return { sortBy: p.sortBy, order: p.order, limit: p.limit, offset: p.offset, total, collections: list };
}

export async function getCollection(db: Db, issuer: string, taxon: number): Promise<unknown> {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select c.id, iss.address as issuer, c.taxon, c.first_seen_ledger,
      cs.name, cs.image_uri, cs.holders, cs.floor::text as floor,
      cs.volume_24h::text as volume_24h, cs.volume_7d::text as volume_7d, cs.volume_all::text as volume_all,
      cs.trades_24h, cs.trades_7d,
      (select count(*) from nft n where n.collection_id = c.id and n.live)::int as live_supply,
      (select count(*) from nft n where n.collection_id = c.id)::int as total_supply
    from nft_collection c
    join account iss on iss.id = c.issuer_id
    left join nft_collection_stats cs on cs.collection_id = c.id
    where iss.address = ${issuer} and c.taxon = ${taxon}
  `);
  if (!row) throw new NotFoundError("collection not found");
  return row;
}

export async function listCollectionNfts(
  db: Db,
  issuer: string,
  taxon: number,
  page: Page,
): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select n.token_id, n.serial, n.uri, n.mint_ledger_seq, n.burn_ledger_seq,
           own.address as owner, m.name, m.image_uri, m.media_type, m.attributes
    from nft n
    join nft_collection c on c.id = n.collection_id
    join account iss on iss.id = c.issuer_id
    left join account own on own.id = n.owner_id
    left join nft_meta m on m.nft_token_id = n.token_id
    where iss.address = ${issuer} and c.taxon = ${taxon}
    order by n.serial asc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}
