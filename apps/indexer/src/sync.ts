import { createLogger } from "@xrpl-indexer/core/logger";
import type { Db } from "@xrpl-indexer/db";
import { XrplClient } from "@xrpl-indexer/xrpl-client";
import { config } from "./config.ts";
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
  const client = new XrplClient({ endpoints: [...config.XRPL_ENDPOINTS], logger: createLogger("xrpl") });
  const registry = new Registry(db);

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
    try {
      while (!stopped && nextSeq <= target) {
        const started = Date.now();
        try {
          const full = await client.fetchLedger(nextSeq);
          const res = await processLedger(full, db, registry);
          const ms = Date.now() - started;
          metrics.processMs.set(ms);
          metrics.ledgersProcessed.inc();
          metrics.lastProcessedLedger.set(res.ledgerIndex);
          metrics.ledgerLagSeconds.set(Math.max(0, Date.now() / 1000 - (full.closeTimeRipple + RIPPLE_EPOCH)));
          log.info({ seq: res.ledgerIndex, txns: res.txnCount, touched: res.touchedTokens, ms }, "ledger");
          nextSeq++;
        } catch (err) {
          metrics.processErrors.inc();
          log.error({ err, seq: nextSeq }, "ledger processing failed; retrying in 2s");
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
      nextSeq = await resolveStart();
      log.info({ nextSeq, endpoints: config.XRPL_ENDPOINTS }, "live sync starting");
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
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
