import { createLogger } from "@xrpl-indexer/core/logger";
import { type Db, schema, sql } from "@xrpl-indexer/db";
import { XrplClient, type FullLedger } from "@xrpl-indexer/xrpl-client";
import { backfillEndpoints, config } from "./config.ts";
import { metrics } from "./metrics.ts";
import { processLedger } from "./process/ledger.ts";
import { Registry } from "./registry.ts";

const { ledger, indexerCheckpoint } = schema;
const log = createLogger("indexer.backfill");

/**
 * Fill everything between `INDEXER_BACKFILL_FLOOR` and the current live head,
 * ascending, skipping ledgers already present. Fetches ahead with bounded
 * concurrency but processes strictly in order (metric points need it).
 */
export async function runBackfill(db: Db): Promise<void> {
  if (config.INDEXER_BACKFILL_FLOOR <= 0) {
    log.info("INDEXER_BACKFILL_FLOOR is 0 — nothing to backfill");
    return;
  }

  // Historical fetches need a full-history node — use the backfill endpoint list.
  const client = new XrplClient({ endpoints: [...backfillEndpoints], logger: createLogger("xrpl.history") });
  await client.connect();
  log.info({ endpoints: backfillEndpoints }, "backfill using full-history endpoints");
  const registry = new Registry(db);
  await registry.init();
  const processOpts = { trackXrpBalances: config.INDEXER_TRACK_XRP_BALANCES };

  const checkpoint = await db.query.indexerCheckpoint.findFirst();
  let head = checkpoint?.lastLedgerSeq;
  if (head === undefined) {
    const { ledger: l } = await client.request<{ ledger: { ledger_index: number | string } }>({
      command: "ledger",
      ledger_index: "validated",
    });
    head = Number(l.ledger_index);
  }

  const floor = config.INDEXER_BACKFILL_FLOOR;
  const [{ present } = { present: 0 }] = await db.execute<{ present: number }>(
    sql`select count(*)::int as present from ${ledger} where sequence between ${floor} and ${head}`,
  );
  log.info({ floor, head, present, span: head - floor + 1 }, "backfill starting");

  const concurrency = config.INDEXER_BACKFILL_CONCURRENCY;
  let nextToFetch = floor;
  const inflight = new Map<number, Promise<FullLedger>>();

  const fetchAhead = () => {
    while (inflight.size < concurrency && nextToFetch <= head!) {
      const seq = nextToFetch++;
      inflight.set(seq, client.fetchLedger(seq));
    }
  };

  for (let seq = floor; seq <= head; seq++) {
    const existing = await db.query.ledger.findFirst({ where: sql`${ledger.sequence} = ${seq}` });
    if (existing) {
      inflight.delete(seq);
      continue;
    }
    fetchAhead();
    const p = inflight.get(seq) ?? client.fetchLedger(seq);
    inflight.delete(seq);
    try {
      const full = await p;
      const res = await processLedger(full, db, registry, processOpts);
      metrics.ledgersProcessed.inc();
      if (seq % 200 === 0) log.info({ seq, txns: res.txnCount }, "backfill progress");
    } catch (err) {
      metrics.processErrors.inc();
      log.error({ err, seq }, "backfill ledger failed; retrying once");
      const full = await client.fetchLedger(seq);
      await processLedger(full, db, registry, processOpts);
    }
  }

  await db
    .update(indexerCheckpoint)
    .set({ updatedAt: sql`now()` })
    .where(sql`${indexerCheckpoint.id} = 1`);
  await client.disconnect();
  log.info({ floor, head }, "backfill complete");
}
