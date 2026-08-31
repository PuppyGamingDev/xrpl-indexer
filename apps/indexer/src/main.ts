import { createLogger } from "@xrpl-indexer/core/logger";
import { closeDb, getDb } from "@xrpl-indexer/db";
import { config } from "./config.ts";
import { runBackfill } from "./backfill.ts";
import { startMetricsServer } from "./metrics.ts";
import { createSyncer } from "./sync.ts";

const log = createLogger("indexer");

const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "live";

async function main(): Promise<void> {
  process.env.SERVICE_NAME = "xrpl-indexer";
  const db = getDb();
  const stopMetrics = startMetricsServer(config.INDEXER_METRICS_PORT);
  log.info({ mode, metricsPort: config.INDEXER_METRICS_PORT }, "starting");

  if (mode === "backfill") {
    await runBackfill(db);
    stopMetrics();
    await closeDb();
    return;
  }

  const syncer = createSyncer(db);
  await syncer.start();

  const shutdown = async (sig: string) => {
    log.info({ sig }, "shutting down");
    await syncer.stop();
    stopMetrics();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err }, "fatal");
  process.exit(1);
});
