import { NotFoundError } from "@xrpl-indexer/core/errors";
import { type Db, sql } from "@xrpl-indexer/db";

export interface IssuerInfo {
  address: string;
  blackholed: boolean;
  pseudo: boolean;
  pseudoSource: string | null;
  meta: {
    name: string | null;
    description: string | null;
    iconUri: string | null;
    twitter: string | null;
    domain: string | null;
    verified: boolean;
  } | null;
  tokensTotal: number;
  collectionsTotal: number;
  nftsTotal: number;
}

export async function getIssuer(db: Db, address: string): Promise<IssuerInfo> {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      a.address, a.blackholed, a.pseudo, a.pseudo_source,
      im.name, im.description, im.icon_uri, im.twitter, im.domain, im.verified,
      (select count(*) from token t
         where t.issuer_id = a.id and t.token_type <> 'XRP')::int         as tokens_total,
      (select count(*) from nft_collection c where c.issuer_id = a.id)::int as collections_total,
      (select count(*) from nft n where n.issuer_id = a.id)::int           as nfts_total
    from account a
    left join issuer_meta im on im.account_id = a.id
    where a.address = ${address}
  `);
  if (!row) throw new NotFoundError("issuer not found");

  const hasMeta =
    row.name != null ||
    row.description != null ||
    row.icon_uri != null ||
    row.twitter != null ||
    row.domain != null;

  return {
    address: row.address as string,
    blackholed: Boolean(row.blackholed),
    pseudo: Boolean(row.pseudo),
    pseudoSource: (row.pseudo_source as string | null) ?? null,
    meta: hasMeta
      ? {
          name: (row.name as string | null) ?? null,
          description: (row.description as string | null) ?? null,
          iconUri: (row.icon_uri as string | null) ?? null,
          twitter: (row.twitter as string | null) ?? null,
          domain: (row.domain as string | null) ?? null,
          verified: Boolean(row.verified),
        }
      : null,
    tokensTotal: Number(row.tokens_total ?? 0),
    collectionsTotal: Number(row.collections_total ?? 0),
    nftsTotal: Number(row.nfts_total ?? 0),
  };
}
