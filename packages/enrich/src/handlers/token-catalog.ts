import { currencyToString } from "@xrpl-indexer/codec";
import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { ProviderIssuer, ProviderToken } from "@xrpl-indexer/sources";
import type { EnrichContext } from "../context.ts";

const { tokenMeta, issuerMeta } = schema;
const log = createLogger("enrich.token-catalog");

const FLUSH_EVERY = 500;

type TokenMetaRow = typeof tokenMeta.$inferInsert;
type IssuerMetaRow = typeof issuerMeta.$inferInsert;

/**
 * Bulk token/issuer enrichment: paginate the entire xrplmeta token list once
 * and upsert `token_meta` + `issuer_meta` for every token we already index.
 * Replaces thousands of per-token `token.metadata` jobs with ~50-60 requests.
 */
export async function handleTokenCatalog(_data: unknown, ctx: EnrichContext): Promise<void> {
  const provider = ctx.providers.tokenCatalog[0];
  if (!provider) {
    log.warn("no token-catalog provider configured");
    return;
  }

  // (issuerAddress:humanCurrency) -> { tokenId, accountId } for every indexed IOU/MPT.
  const index = new Map<string, { tokenId: number; accountId: number }>();
  const rows = await ctx.db.execute<{
    token_id: number;
    currency: string | null;
    account_id: number;
    address: string;
  }>(sql`
    select t.id as token_id, t.currency, a.id as account_id, a.address
    from token t join account a on a.id = t.issuer_id
    where t.token_type <> 'XRP'
  `);
  for (const r of rows) {
    if (!r.currency) continue;
    index.set(`${r.address}:${currencyToString(r.currency)}`, {
      tokenId: Number(r.token_id),
      accountId: Number(r.account_id),
    });
  }
  log.info({ indexed: index.size }, "token catalog: matching against indexed tokens");

  const tokenBuf: TokenMetaRow[] = [];
  const issuerBuf = new Map<number, IssuerMetaRow>();
  let matched = 0;
  let scanned = 0;

  for await (const { token, issuer } of provider.fetchAllTokens()) {
    scanned++;
    const hit = index.get(`${token.issuer}:${currencyToString(token.currency)}`);
    if (!hit) continue;
    matched++;

    tokenBuf.push(tokenRow(hit.tokenId, token));
    if (issuer) issuerBuf.set(hit.accountId, issuerRow(hit.accountId, issuer));

    if (tokenBuf.length >= FLUSH_EVERY) {
      await flushTokens(ctx, tokenBuf.splice(0));
      await flushIssuers(ctx, [...issuerBuf.values()]);
      issuerBuf.clear();
    }
  }
  await flushTokens(ctx, tokenBuf);
  await flushIssuers(ctx, [...issuerBuf.values()]);

  log.info({ scanned, matched }, "token catalog complete");
}

function tokenRow(tokenId: number, t: ProviderToken): TokenMetaRow {
  return {
    tokenId,
    name: t.name,
    description: t.description,
    iconUri: t.iconUri,
    domain: t.domain,
    links: t.links ?? null,
    trustLevel: t.trustLevel,
    source: "xrplmeta",
    raw: (t.raw ?? null) as Record<string, unknown> | null,
    error: null,
    fetchedAt: new Date(),
  };
}

function issuerRow(accountId: number, i: ProviderIssuer): IssuerMetaRow {
  return {
    accountId,
    name: i.name,
    description: i.description,
    iconUri: i.iconUri,
    twitter: i.twitter,
    domain: i.domain,
    verified: i.verified,
    source: "xrplmeta",
    fetchedAt: new Date(),
  };
}

async function flushTokens(ctx: EnrichContext, rows: TokenMetaRow[]): Promise<void> {
  if (rows.length === 0) return;
  await ctx.db
    .insert(tokenMeta)
    .values(rows)
    .onConflictDoUpdate({
      target: tokenMeta.tokenId,
      set: {
        name: sql`coalesce(excluded.name, ${tokenMeta.name})`,
        description: sql`coalesce(excluded.description, ${tokenMeta.description})`,
        iconUri: sql`coalesce(excluded.icon_uri, ${tokenMeta.iconUri})`,
        domain: sql`coalesce(excluded.domain, ${tokenMeta.domain})`,
        links: sql`coalesce(excluded.links, ${tokenMeta.links})`,
        trustLevel: sql`greatest(excluded.trust_level, ${tokenMeta.trustLevel})`,
        source: sql`excluded.source`,
        raw: sql`excluded.raw`,
        error: sql`null`,
        fetchedAt: sql`now()`,
      },
    });
}

async function flushIssuers(ctx: EnrichContext, rows: IssuerMetaRow[]): Promise<void> {
  if (rows.length === 0) return;
  await ctx.db
    .insert(issuerMeta)
    .values(rows)
    .onConflictDoUpdate({
      target: issuerMeta.accountId,
      set: {
        name: sql`coalesce(excluded.name, ${issuerMeta.name})`,
        description: sql`coalesce(excluded.description, ${issuerMeta.description})`,
        iconUri: sql`coalesce(excluded.icon_uri, ${issuerMeta.iconUri})`,
        twitter: sql`coalesce(excluded.twitter, ${issuerMeta.twitter})`,
        domain: sql`coalesce(excluded.domain, ${issuerMeta.domain})`,
        verified: sql`excluded.verified or ${issuerMeta.verified}`,
        source: sql`excluded.source`,
        fetchedAt: sql`now()`,
      },
    });
}
