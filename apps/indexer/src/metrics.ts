import { createServer } from "node:http";
import { collectDefaultMetrics, Counter, Gauge, Registry as PromRegistry } from "prom-client";

export const promRegistry = new PromRegistry();
collectDefaultMetrics({ register: promRegistry });

export const metrics = {
  lastProcessedLedger: new Gauge({
    name: "indexer_last_processed_ledger",
    help: "Highest ledger index fully written",
    registers: [promRegistry],
  }),
  ledgerLagSeconds: new Gauge({
    name: "indexer_ledger_lag_seconds",
    help: "Wall-clock seconds between now and the last processed ledger close time",
    registers: [promRegistry],
  }),
  ledgersProcessed: new Counter({
    name: "indexer_ledgers_processed_total",
    help: "Ledgers processed since start",
    registers: [promRegistry],
  }),
  processErrors: new Counter({
    name: "indexer_process_errors_total",
    help: "Ledger processing errors",
    registers: [promRegistry],
  }),
  processMs: new Gauge({
    name: "indexer_process_ledger_ms",
    help: "Duration of the last processLedger call",
    registers: [promRegistry],
  }),
};

export function startMetricsServer(port: number): () => void {
  const server = createServer(async (req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": promRegistry.contentType });
      res.end(await promRegistry.metrics());
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port);
  return () => server.close();
}
