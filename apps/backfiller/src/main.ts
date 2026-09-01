import { createServer } from "node:http";
import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";
import { createLogger } from "@xrpl-indexer/core/logger";
import { closeDb, getDb } from "@xrpl-indexer/db";
import {
  createContext,
  enrichEnvSchema,
  registerWorkers,
  runDiscovery,
  toEnrichConfig,
} from "@xrpl-indexer/enrich";
import { Jobs } from "@xrpl-indexer/jobs";

loadEnv();
const log = createLogger("backfiller");

const config = defineConfig({
  ...baseEnvSchema,
  ...enrichEnvSchema,
  BACKFILLER_METRICS_PORT: z.coerce.number().int().positive().default(9102),
  ROLLUP_CRON: z.string().default("*/15 * * * *"),
  DISCOVERY_CRON: z.string().default("*/5 * * * *"),
  TOKEN_CATALOG_CRON: z.string().default("0 */6 * * *"),
});

const once = process.argv.includes("--once");

process.env.SERVICE_NAME = "xrpl-backfiller";
const db = getDb();
const jobs = new Jobs({ ensureQueues: true });
await jobs.start();
const ctx = createContext(db, jobs, toEnrichConfig(config));

if (once) {
  await runDiscovery(ctx);
  await jobs.stop();
  await closeDb();
  process.exit(0);
}

// The backfiller both schedules and services the singleton/cron queues, so they
// run regardless of the worker fleet's WORKER_QUEUES list.
await registerWorkers(ctx, ["discovery.scan", "stats.rollup", "token.catalog"], {});

await jobs.schedule("stats.rollup", config.ROLLUP_CRON, {});
await jobs.schedule("discovery.scan", config.DISCOVERY_CRON, {});
await jobs.schedule("token.catalog", config.TOKEN_CATALOG_CRON, {});
log.info(
  { rollup: config.ROLLUP_CRON, discovery: config.DISCOVERY_CRON, tokenCatalog: config.TOKEN_CATALOG_CRON },
  "schedules registered",
);

// one immediate pass so a fresh deploy fills / refreshes without waiting on cron
await runDiscovery(ctx).catch((err) => log.error({ err }, "initial discovery failed"));
await jobs.enqueue("token.catalog", {}, { key: "token.catalog:boot" }).catch(() => {});
await jobs.enqueue("stats.rollup", {}, { key: "stats.rollup:boot" }).catch(() => {});

const health = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
});
health.listen(config.BACKFILLER_METRICS_PORT);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (async () => {
      log.info({ sig }, "shutting down");
      health.close();
      await jobs.stop();
      await closeDb();
      process.exit(0);
    })();
  });
}
