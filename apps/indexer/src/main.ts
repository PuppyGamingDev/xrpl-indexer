import { createLogger } from "@xrpl-indexer/core/logger";
import { closeDb, getDb } from "@xrpl-indexer/db";
import { config } from "./config.ts";
import { runBackfill } from "./backfill.ts";
import { startMetricsServer } from "./metrics.ts";
import { isSnapshotDone, runSnapshot } from "./snapshot.ts";
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

  if (mode === "snapshot") {
    await runSnapshot(db);
    stopMetrics();
    await closeDb();
    return;
  }

  // Live mode: if a full initial state snapshot has never completed, run it
  // first (resumable), then hand off to live sync which catches up from the
  // checkpoint to current.
  if (config.INDEXER_SNAPSHOT_ON_START && !(await isSnapshotDone(db))) {
    log.info("initial state snapshot not complete — running it before live sync");
    await runSnapshot(db);
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
