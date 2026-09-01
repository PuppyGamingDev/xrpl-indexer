import type { EnrichContext } from "./context.ts";
import { handleIssuerMetadata } from "./handlers/issuer-metadata.ts";
import { handleNftCollection } from "./handlers/nft-collection.ts";
import { handleNftMetadata } from "./handlers/nft-metadata.ts";
import { handleTokenCatalog } from "./handlers/token-catalog.ts";
import { handleTokenMetadata } from "./handlers/token-metadata.ts";
import { runDiscovery } from "./discovery.ts";
import { runRollup } from "./rollup.ts";

export * from "./context.ts";
export * from "./env.ts";
export { runDiscovery, type DiscoveryOptions } from "./discovery.ts";
export { runRollup } from "./rollup.ts";
export { handleTokenCatalog } from "./handlers/token-catalog.ts";

/** Queues this process should service, e.g. from `WORKER_QUEUES` env. */
export type WorkableQueue =
  | "nft.metadata"
  | "nft.collection"
  | "token.metadata"
  | "token.catalog"
  | "issuer.metadata"
  | "stats.rollup"
  | "discovery.scan";

/** Per-queue worker counts. `default` covers anything unset; sensible built-ins otherwise. */
export interface WorkerConcurrency {
  default?: number;
  "nft.metadata"?: number;
  "nft.collection"?: number;
  "token.metadata"?: number;
}

const BUILTIN: Record<string, number> = {
  "nft.metadata": 8,
  // Whole-issuer catalog streamers. They insert `nft` stubs (FK-locks `account`
  // rows) but only via `on conflict do nothing`, and in practice haven't
  // deadlocked with live sync — 4 in parallel to actually drain 13k issuers.
  "nft.collection": 4,
  "token.metadata": 4,
};

/** Register pg-boss workers for the requested queues. */
export async function registerWorkers(
  ctx: EnrichContext,
  queues: WorkableQueue[],
  cc: WorkerConcurrency = {},
): Promise<void> {
  const pick = (q: string): number =>
    cc[q as keyof WorkerConcurrency] ?? cc.default ?? BUILTIN[q] ?? 1;

  for (const q of queues) {
    switch (q) {
      case "nft.metadata":
        await ctx.jobs.work("nft.metadata", { concurrency: pick(q) }, (d) => handleNftMetadata(d, ctx));
        break;
      case "nft.collection":
        await ctx.jobs.work("nft.collection", { concurrency: pick(q) }, (d) => handleNftCollection(d, ctx));
        break;
      case "token.metadata":
        await ctx.jobs.work("token.metadata", { concurrency: pick(q) }, (d) => handleTokenMetadata(d, ctx));
        break;
      case "token.catalog":
        await ctx.jobs.work("token.catalog", { concurrency: 1 }, () => handleTokenCatalog(null, ctx));
        break;
      case "issuer.metadata":
        await ctx.jobs.work("issuer.metadata", { concurrency: pick(q) }, (d) => handleIssuerMetadata(d, ctx));
        break;
      case "stats.rollup":
        await ctx.jobs.work("stats.rollup", { concurrency: 1 }, () => runRollup(ctx));
        break;
      case "discovery.scan":
        await ctx.jobs.work("discovery.scan", { concurrency: 1 }, (d) => runDiscovery(ctx, d.kinds));
        break;
    }
  }
}
