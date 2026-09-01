import { createLogger } from "@xrpl-indexer/core/logger";
import { type Db, eq, schema, sql } from "@xrpl-indexer/db";
import { XrplClient, type FullLedger } from "@xrpl-indexer/xrpl-client";
import { backfillEndpoints, config } from "./config.ts";
import { metrics } from "./metrics.ts";
import { processLedger, type ProcessOptions } from "./process/ledger.ts";
import { Registry } from "./registry.ts";

const { ledger, ledgerGap } = schema;
const log = createLogger("indexer.backfill");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Gap {
  id: number;
  rangeStart: number;
  rangeEnd: number;
}

/**
 * Historical ledger backfill. Walks DESCENDING from the first indexed ledger
 * (`min(ledger.sequence) - 1`) down to `INDEXER_BACKFILL_FLOOR`, replaying each
 * ledger's transactions through the same pipeline as live sync but in "backfill"
 * mode (conflict-do-nothing, no per-ledger metric points).
 *
 * Progress is tracked in `ledger_gap`: one row, `range_end` walked downward as a
 * resumable cursor. A crash + PM2 restart resumes from the persisted `range_end`.
 * When a range completes the process idles and re-checks for new pending ranges
 * (e.g. if the floor is later lowered) instead of exiting.
 */
export async function runBackfill(db: Db): Promise<void> {
  if (!config.INDEXER_BACKFILL_ENABLED) {
    log.info("INDEXER_BACKFILL_ENABLED is not set — backfiller idle");
    for (;;) await sleep(60 * 60_000);
  }
  if (config.INDEXER_BACKFILL_FLOOR <= 0) {
    log.info("INDEXER_BACKFILL_FLOOR is 0 — nothing to backfill");
    for (;;) await sleep(60 * 60_000);
  }

  const floor = config.INDEXER_BACKFILL_FLOOR;
  const client = new XrplClient({
    endpoints: [...backfillEndpoints],
    logger: createLogger("xrpl.history"),
  });
  await client.connect();
  log.info({ endpoints: backfillEndpoints, floor }, "backfill using full-history endpoints");

  const registry = new Registry(db);
  await registry.init();
  const opts: ProcessOptions = {
    trackXrpBalances: config.INDEXER_TRACK_XRP_BALANCES,
    mode: "backfill",
  };

  for (;;) {
    const gap = await claimOrCreateGap(db, floor);
    if (!gap) {
      log.info("no pending backfill range — idle");
      await sleep(5 * 60_000);
      continue;
    }
    log.info({ gap }, "backfill range starting");
    try {
      await runGap(db, client, registry, opts, gap);
      log.info({ gap: gap.id }, "backfill range complete");
    } catch (err) {
      // Leave the row in 'running' — its range_end cursor is the resume point.
      log.error({ err, gap: gap.id }, "backfill range errored; retrying after backoff");
      await sleep(30_000);
    }
  }
}

/** Resume any unfinished range, else open a new one from the current frontier. */
async function claimOrCreateGap(db: Db, floor: number): Promise<Gap | null> {
  return db.transaction(async (tx) => {
    const [open] = await tx.execute<{ id: number; range_start: number; range_end: number }>(sql`
      select id, range_start, range_end
      from ${ledgerGap}
      where state <> 'done'
      order by range_end desc
      limit 1
      for update skip locked
    `);
    if (open) {
      await tx.execute(sql`update ${ledgerGap} set state = 'running', updated_at = now() where id = ${open.id}`);
      return { id: Number(open.id), rangeStart: open.range_start, rangeEnd: open.range_end };
    }

    const [f] = await tx.execute<{ frontier: number | null }>(
      sql`select min(sequence) as frontier from ${ledger}`,
    );
    const frontier = f?.frontier ?? null;
    if (frontier == null || frontier - 1 < floor) return null;

    const [covered] = await tx.execute<{ one: number }>(sql`
      select 1 as one from ${ledgerGap} where range_start <= ${floor} limit 1
    `);
    if (covered) return null;

    const [row] = await tx.execute<{ id: number; range_start: number; range_end: number }>(sql`
      insert into ${ledgerGap} (range_start, range_end, state)
      values (${floor}, ${frontier - 1}, 'running')
      returning id, range_start, range_end
    `);
    return { id: Number(row!.id), rangeStart: row!.range_start, rangeEnd: row!.range_end };
  });
}

async function runGap(
  db: Db,
  client: XrplClient,
  registry: Registry,
  opts: ProcessOptions,
  gap: Gap,
): Promise<void> {
  const chunk = config.INDEXER_BACKFILL_CONCURRENCY * 4;
  let cursor = gap.rangeEnd;

  while (cursor >= gap.rangeStart) {
    const lo = Math.max(gap.rangeStart, cursor - chunk + 1);
    const present = new Set(await existingSequences(db, lo, cursor));
    const todo: number[] = [];
    for (let s = cursor; s >= lo; s--) if (!present.has(s)) todo.push(s);

    await processDescending(db, client, registry, opts, todo);

    cursor = lo - 1;
    await db
      .update(ledgerGap)
      .set({ rangeEnd: Math.max(gap.rangeStart - 1, cursor), updatedAt: sql`now()` })
      .where(eq(ledgerGap.id, gap.id));
    log.info({ gap: gap.id, cursor: cursor + 1, floor: gap.rangeStart }, "backfill progress");
  }

  await db
    .update(ledgerGap)
    .set({ state: "done", rangeEnd: gap.rangeStart - 1, updatedAt: sql`now()` })
    .where(eq(ledgerGap.id, gap.id));
}

async function existingSequences(db: Db, lo: number, hi: number): Promise<number[]> {
  const rows = await db.execute<{ sequence: number }>(
    sql`select sequence from ${ledger} where sequence between ${lo} and ${hi}`,
  );
  return rows.map((r) => Number(r.sequence));
}

/** Fetch ahead with bounded concurrency, apply strictly in the given (descending) order. */
async function processDescending(
  db: Db,
  client: XrplClient,
  registry: Registry,
  opts: ProcessOptions,
  seqs: number[],
): Promise<void> {
  const conc = config.INDEXER_BACKFILL_CONCURRENCY;
  const inflight = new Map<number, Promise<FullLedger>>();
  let next = 0;
  const kick = (): void => {
    while (inflight.size < conc && next < seqs.length) {
      const s = seqs[next++]!;
      inflight.set(s, client.fetchLedger(s));
    }
  };
  kick();

  for (const seq of seqs) {
    const p = inflight.get(seq) ?? client.fetchLedger(seq);
    inflight.delete(seq);
    kick();
    try {
      await processLedger(await p, db, registry, opts);
      metrics.ledgersProcessed.inc();
    } catch (err) {
      metrics.processErrors.inc();
      log.warn({ err, seq }, "backfill ledger failed; retrying once");
      try {
        await processLedger(await client.fetchLedger(seq), db, registry, opts);
        metrics.ledgersProcessed.inc();
      } catch (err2) {
        log.error({ err: err2, seq }, "backfill ledger failed twice; skipping");
      }
    }
  }
}
