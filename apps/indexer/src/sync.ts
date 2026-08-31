import { createLogger } from "@xrpl-indexer/core/logger";
import type { Db } from "@xrpl-indexer/db";
import { XrplClient } from "@xrpl-indexer/xrpl-client";
import { backfillEndpoints, config, syncEndpoints } from "./config.ts";
import { metrics } from "./metrics.ts";
import { processLedger } from "./process/ledger.ts";
import { Registry } from "./registry.ts";

const log = createLogger("indexer.sync");

const RIPPLE_EPOCH = 946_684_800;

export interface Syncer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createSyncer(db: Db): Syncer {
  // Live subscription + catch-up: a (possibly non-full-history) node such as your own Clio.
  const client = new XrplClient({ endpoints: [...syncEndpoints], logger: createLogger("xrpl.sync") });
  const registry = new Registry(db);

  // Fallback for catch-up gaps the sync node can't serve (ledgers older than its
  // retained window). Only spun up on demand.
  const historyIsSeparate =
    JSON.stringify([...backfillEndpoints].sort()) !== JSON.stringify([...syncEndpoints].sort());
  let historyClient: XrplClient | undefined;
  async function historyFetcher(): Promise<XrplClient> {
    if (!historyIsSeparate) return client;
    if (!historyClient) {
      historyClient = new XrplClient({
        endpoints: [...backfillEndpoints],
        logger: createLogger("xrpl.history"),
      });
      await historyClient.connect();
      log.info({ endpoints: backfillEndpoints }, "connected full-history endpoints for catch-up");
    }
    return historyClient;
  }

  let nextSeq = 0;
  let draining = false;
  let stopped = false;

  async function resolveStart(): Promise<number> {
    const checkpoint = await db.query.indexerCheckpoint.findFirst();
    if (checkpoint) return checkpoint.lastLedgerSeq + 1;
    if (config.INDEXER_START_LEDGER !== "current") return Number(config.INDEXER_START_LEDGER);
    const { ledger } = await client.request<{ ledger: { ledger_index: number | string } }>({
      command: "ledger",
      ledger_index: "validated",
    });
    return Number(ledger.ledger_index);
  }

  async function drainUpTo(target: number): Promise<void> {
    if (draining) return;
    draining = true;
    let failures = 0;
    try {
      while (!stopped && nextSeq <= target) {
        const started = Date.now();
        try {
          // After two failures on the sync node, assume the ledger is outside
          // its retained window and pull it from the full-history endpoints.
          const src = failures >= 2 ? await historyFetcher() : client;
          const full = await src.fetchLedger(nextSeq);
          const res = await processLedger(full, db, registry, {
            trackXrpBalances: config.INDEXER_TRACK_XRP_BALANCES,
          });
          const ms = Date.now() - started;
          metrics.processMs.set(ms);
          metrics.ledgersProcessed.inc();
          metrics.lastProcessedLedger.set(res.ledgerIndex);
          metrics.ledgerLagSeconds.set(Math.max(0, Date.now() / 1000 - (full.closeTimeRipple + RIPPLE_EPOCH)));
          log.info({ seq: res.ledgerIndex, txns: res.txnCount, touched: res.touchedTokens, ms }, "ledger");
          nextSeq++;
          failures = 0;
        } catch (err) {
          failures++;
          metrics.processErrors.inc();
          log.error(
            { err, seq: nextSeq, failures },
            failures >= 2 && historyIsSeparate
              ? "sync node cannot serve this ledger; falling back to full-history endpoints"
              : "ledger processing failed; retrying in 2s",
          );
          await sleep(2_000);
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    async start() {
      await client.connect();
      await registry.init();
      nextSeq = await resolveStart();
      log.info(
        { nextSeq, syncEndpoints, backfillEndpoints, historyIsSeparate },
        "live sync starting",
      );
      client.onValidatedLedger((l) => {
        void drainUpTo(l.ledgerIndex);
      });
      // kick off immediately in case the stream is quiet
      const { ledger } = await client.request<{ ledger: { ledger_index: number | string } }>({
        command: "ledger",
        ledger_index: "validated",
      });
      void drainUpTo(Number(ledger.ledger_index));
    },
    async stop() {
      stopped = true;
      await client.disconnect();
      await historyClient?.disconnect();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
