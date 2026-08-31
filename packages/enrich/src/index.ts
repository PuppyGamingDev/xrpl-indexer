import type { PgBoss } from "@xrpl-indexer/jobs";
import type { EnrichContext } from "./context.ts";
import { handleIssuerMetadata } from "./handlers/issuer-metadata.ts";
import { handleNftCollection } from "./handlers/nft-collection.ts";
import { handleNftMetadata } from "./handlers/nft-metadata.ts";
import { handleTokenMetadata } from "./handlers/token-metadata.ts";
import { runDiscovery } from "./discovery.ts";
import { runRollup } from "./rollup.ts";

export * from "./context.ts";
export * from "./env.ts";
export { runDiscovery, type DiscoveryOptions } from "./discovery.ts";
export { runRollup } from "./rollup.ts";

/** Queues this process should service, e.g. from `WORKER_QUEUES` env. */
export type WorkableQueue =
  | "nft.metadata"
  | "nft.collection"
  | "token.metadata"
  | "issuer.metadata"
  | "stats.rollup"
  | "discovery.scan";

/** Register pg-boss workers for the requested queues. */
export async function registerWorkers(
  ctx: EnrichContext,
  queues: WorkableQueue[],
  concurrency: number,
): Promise<void> {
  const opts: PgBoss.WorkOptions = { batchSize: Math.max(1, Math.min(concurrency, 50)) };

  for (const q of queues) {
    switch (q) {
      case "nft.metadata":
        await ctx.jobs.work("nft.metadata", opts, (d) => handleNftMetadata(d, ctx));
        break;
      case "nft.collection":
        await ctx.jobs.work("nft.collection", { batchSize: 1 }, (d) => handleNftCollection(d, ctx));
        break;
      case "token.metadata":
        await ctx.jobs.work("token.metadata", opts, (d) => handleTokenMetadata(d, ctx));
        break;
      case "issuer.metadata":
        await ctx.jobs.work("issuer.metadata", opts, (d) => handleIssuerMetadata(d, ctx));
        break;
      case "stats.rollup":
        await ctx.jobs.work("stats.rollup", { batchSize: 1 }, () => runRollup(ctx));
        break;
      case "discovery.scan":
        await ctx.jobs.work("discovery.scan", { batchSize: 1 }, (d) => runDiscovery(ctx, d.kinds));
        break;
    }
  }
}
