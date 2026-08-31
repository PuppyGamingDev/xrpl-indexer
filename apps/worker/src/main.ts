import { createServer } from "node:http";
import { baseEnvSchema, defineConfig, loadEnv, z } from "@xrpl-indexer/core/config";
import { createLogger } from "@xrpl-indexer/core/logger";
import { closeDb, getDb } from "@xrpl-indexer/db";
import { createContext, enrichEnvSchema, registerWorkers, toEnrichConfig, type WorkableQueue } from "@xrpl-indexer/enrich";
import { Jobs } from "@xrpl-indexer/jobs";

loadEnv();
const log = createLogger("worker");

const config = defineConfig({
  ...baseEnvSchema,
  ...enrichEnvSchema,
  WORKER_QUEUES: z
    .string()
    .default("nft.metadata,token.metadata,issuer.metadata")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean) as WorkableQueue[]),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(25),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9103),
});

process.env.SERVICE_NAME = "xrpl-worker";
const db = getDb();
const jobs = new Jobs({ ensureQueues: false });
await jobs.start();

const ctx = createContext(db, jobs, toEnrichConfig(config));
await registerWorkers(ctx, config.WORKER_QUEUES, config.WORKER_CONCURRENCY);
log.info(
  { queues: config.WORKER_QUEUES, concurrency: config.WORKER_CONCURRENCY, bithomp: Boolean(config.BITHOMP_API_KEY) },
  "worker started",
);

const health = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
});
health.listen(config.WORKER_METRICS_PORT);

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
