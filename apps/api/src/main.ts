import { createLogger } from "@xrpl-indexer/core/logger";
import { config } from "./config.ts";
import { closeApiDb } from "./db.ts";
import { buildServer } from "./server.ts";

const log = createLogger("api");

const app = await buildServer();

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  log.info({ port: config.API_PORT }, "api listening");
} catch (err) {
  log.fatal({ err }, "failed to start");
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void (async () => {
      log.info({ sig }, "shutting down");
      await app.close();
      await closeApiDb();
      process.exit(0);
    })();
  });
}
