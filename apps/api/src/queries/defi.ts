import { type Db, sql } from "@xrpl-indexer/db";
import type { Page } from "./common.ts";

export async function listAmm(db: Db, page: Page): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select
      acc.address as account, a.lp_token_currency, a.trading_fee, a.created_ledger_seq,
      t1.token_type as asset1_type, t1.currency as asset1_currency, i1.address as asset1_issuer,
      t2.token_type as asset2_type, t2.currency as asset2_currency, i2.address as asset2_issuer,
      (select balance::text from account_balance ab where ab.account_id = a.account_id and ab.token_id = a.asset1_token_id order by ledger_seq desc limit 1) as asset1_balance,
      (select balance::text from account_balance ab where ab.account_id = a.account_id and ab.token_id = a.asset2_token_id order by ledger_seq desc limit 1) as asset2_balance
    from amm a
    join account acc on acc.id = a.account_id
    join token t1 on t1.id = a.asset1_token_id
    left join account i1 on i1.id = t1.issuer_id
    join token t2 on t2.id = a.asset2_token_id
    left join account i2 on i2.id = t2.issuer_id
    order by a.created_ledger_seq desc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}

export async function listVaults(db: Db, page: Page): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select v.vault_id, o.address as owner, p.address as pseudo_account,
           t.token_type as asset_type, t.currency as asset_currency, ti.address as asset_issuer,
           v.share_mpt_id, v.assets_total::text, v.assets_available::text, v.assets_maximum::text,
           v.flags, v.ledger_seq
    from vault v
    join account o on o.id = v.owner_id
    left join account p on p.id = v.pseudo_account_id
    join token t on t.id = v.asset_token_id
    left join account ti on ti.id = t.issuer_id
    order by v.ledger_seq desc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}

export async function listOracles(db: Db, page: Page): Promise<unknown[]> {
  const rows = await db.execute(sql`
    select o.oracle_id, ow.address as owner, o.provider, o.asset_class, o.uri,
           o.last_update_time, o.price_data_count, o.ledger_seq
    from oracle o
    join account ow on ow.id = o.owner_id
    order by o.ledger_seq desc
    limit ${page.limit} offset ${page.offset}
  `);
  return [...rows];
}
