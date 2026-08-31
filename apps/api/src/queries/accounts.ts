import { type Db, sql } from "@xrpl-indexer/db";
import type { Page } from "./common.ts";

export async function accountNfts(db: Db, address: string, page: Page): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select n.token_id, n.taxon, n.serial, n.uri, n.collection_id, n.mint_ledger_seq,
           iss.address as issuer, m.name, m.image_uri, m.media_type, m.attributes
    from nft n
    join account own on own.id = n.owner_id
    join account iss on iss.id = n.issuer_id
    left join nft_meta m on m.nft_token_id = n.token_id
    where own.address = ${address} and n.live
    order by n.mint_ledger_seq desc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}

/** Latest balance per token the address currently holds (> 0). `kind` filters MPT vs IOU. */
export async function accountHoldings(
  db: Db,
  address: string,
  kind: "IOU" | "MPT" | "all",
  page: Page,
): Promise<unknown[]> {
  const rows = await db.execute(sql`
    with acct as (select id from account where address = ${address}),
    latest as (
      select distinct on (ab.token_id) ab.token_id, ab.balance, ab.ledger_seq
      from account_balance ab, acct
      where ab.account_id = acct.id
      order by ab.token_id, ab.ledger_seq desc
    )
    select
      t.token_type, t.currency, t.mpt_issuance_id, iss.address as issuer,
      l.balance::text as balance, l.ledger_seq, tm.name
    from latest l
    join token t on t.id = l.token_id
    left join account iss on iss.id = t.issuer_id
    left join token_meta tm on tm.token_id = t.id
    where l.balance > 0
      ${kind === "all" ? sql`` : sql`and t.token_type = ${kind}`}
    order by l.balance desc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}
