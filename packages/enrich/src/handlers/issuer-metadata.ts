import { createLogger } from "@xrpl-indexer/core/logger";
import { schema, sql } from "@xrpl-indexer/db";
import type { JobPayloads } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "../context.ts";

const { issuerMeta } = schema;
const log = createLogger("enrich.issuer-metadata");

export async function handleIssuerMetadata(
  data: JobPayloads["issuer.metadata"],
  ctx: EnrichContext,
): Promise<void> {
  for (const p of ctx.providers.tokenInfo) {
    if (!p.fetchIssuer) continue;
    try {
      const r = await p.fetchIssuer(data.address);
      if (!r) continue;
      await ctx.db
        .insert(issuerMeta)
        .values({
          accountId: data.accountId,
          name: r.name,
          description: r.description,
          iconUri: r.iconUri,
          twitter: r.twitter,
          domain: r.domain,
          verified: r.verified,
          source: p.name as "xrplto" | "xrplmeta",
          fetchedAt: new Date(),
        })
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
      return;
    } catch (err) {
      log.debug({ err, provider: p.name }, "issuer provider failed");
    }
  }
}
