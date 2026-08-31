import { createServer } from "node:http";
import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";
import { createLogger } from "@xrpl-indexer/core/logger";
import { closeDb, getDb } from "@xrpl-indexer/db";
import { createContext, enrichEnvSchema, runDiscovery, toEnrichConfig } from "@xrpl-indexer/enrich";
import { Jobs } from "@xrpl-indexer/jobs";

loadEnv();
const log = createLogger("backfiller");

const config = defineConfig({
  ...baseEnvSchema,
  ...enrichEnvSchema,
  BACKFILLER_METRICS_PORT: z.coerce.number().int().positive().default(9102),
  DISCOVERY_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ROLLUP_CRON: z.string().default("*/5 * * * *"),
  DISCOVERY_CRON: z.string().default("*/2 * * * *"),
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

// cron-scheduled recurring jobs (workers pick these up)
await jobs.schedule("stats.rollup", config.ROLLUP_CRON, {});
await jobs.schedule("discovery.scan", config.DISCOVERY_CRON, {});
log.info({ rollup: config.ROLLUP_CRON, discovery: config.DISCOVERY_CRON }, "schedules registered");

// also scan directly on an interval so a fresh DB fills fast without waiting on cron
await runDiscovery(ctx).catch((err) => log.error({ err }, "initial discovery failed"));
const timer = setInterval(() => {
  void runDiscovery(ctx).catch((err) => log.error({ err }, "discovery tick failed"));
}, config.DISCOVERY_INTERVAL_MS);

const health = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
});
health.listen(config.BACKFILLER_METRICS_PORT);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (async () => {
      log.info({ sig }, "shutting down");
      clearInterval(timer);
      health.close();
      await jobs.stop();
      await closeDb();
      process.exit(0);
    })();
  });
}
