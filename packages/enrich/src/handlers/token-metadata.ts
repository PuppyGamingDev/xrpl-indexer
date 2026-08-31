import { currencyToString } from "@xrpl-indexer/codec";
import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { ProviderToken } from "@xrpl-indexer/sources";
import type { EnrichContext } from "../context.ts";

const { tokenMeta, issuerMeta } = schema;
const log = createLogger("enrich.token-metadata");

export async function handleTokenMetadata(
  data: JobPayloads["token.metadata"],
  ctx: EnrichContext,
): Promise<void> {
  const [row] = await ctx.db.execute<{
    token_type: string;
    currency: string | null;
    issuer: string | null;
  }>(sql`
    select t.token_type, t.currency, a.address as issuer
    from token t left join account a on a.id = t.issuer_id
    where t.id = ${data.tokenId}
  `);
  if (!row || !row.issuer || row.token_type === "XRP") return;

  const currency = row.currency ? currencyToString(row.currency) : "";
  let best: ProviderToken | null = null;
  for (const p of ctx.providers.tokenInfo) {
    try {
      const r = await p.fetchToken(currency, row.issuer);
      if (r && (!best || (r.name && !best.name))) best = r;
    } catch (err) {
      log.debug({ err, provider: p.name }, "token provider failed");
    }
  }
  if (!best) return;

  await ctx.db
    .insert(tokenMeta)
    .values({
      tokenId: data.tokenId,
      name: best.name,
      description: best.description,
      iconUri: best.iconUri,
      domain: best.domain,
      links: best.links ?? null,
      trustLevel: best.trustLevel,
      source: best === null ? "xrplto" : (guessSource(best) as "xrplto" | "xrplmeta"),
      raw: best.raw as Record<string, unknown>,
      fetchedAt: new Date(),
    })
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
        fetchedAt: sql`now()`,
      },
    });

  // opportunistically enrich the issuer too
  const [acct] = await ctx.db.execute<{ id: number }>(sql`
    select id from account where address = ${row.issuer}
  `);
  if (acct) {
    await ctx.jobs.enqueue(
      "issuer.metadata",
      { accountId: acct.id, address: row.issuer },
      { key: `issuer:${acct.id}` },
    );
  }
  void issuerMeta;
}

function guessSource(t: ProviderToken): string {
  const raw = t.raw as { meta?: unknown; md5?: unknown } | null;
  if (raw && "meta" in raw) return "xrplmeta";
  if (raw && "md5" in raw) return "xrplto";
  return "xrplto";
}
