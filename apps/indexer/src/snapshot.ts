import { currencyToString, hexToAddress, parseMptIssuanceId, parseNftId } from "@xrpl-indexer/codec";
import { createLogger } from "@xrpl-indexer/core/logger";
import { type Db, schema, sql } from "@xrpl-indexer/db";
import { XrplClient, type LedgerDataEntry } from "@xrpl-indexer/xrpl-client";
import { LedgerBatch } from "./batch.ts";
import { backfillEndpoints, config, snapshotEndpoints } from "./config.ts";
import type { NormalizedNode } from "./process/affected-nodes.ts";
import { handleAccountRoot } from "./process/handlers/account.ts";
import { handleAmm } from "./process/handlers/amm.ts";
import { handleMpToken, handleMptIssuance } from "./process/handlers/mpt.ts";
import { snapshotNftOffer, snapshotNftPage } from "./process/handlers/nft.ts";
import { handleOracle } from "./process/handlers/oracle.ts";
import { handleRippleState } from "./process/handlers/trustline.ts";
import { handleVault } from "./process/handlers/vault.ts";
import { Registry } from "./registry.ts";

const { snapshotState, indexerCheckpoint, ledger } = schema;
const log = createLogger("indexer.snapshot");
const ONE = sql`${snapshotState.id} = 1`;

const PAGE_LIMIT = 2_048;
/** Accumulate this many entries across pages before a flush + marker checkpoint. */
const FLUSH_EVERY = 20_000;

/**
 * Two keyspace walks instead of one per entry type — a `ledger_data` `type`
 * filter makes the node scan the whole keyspace *and* return a sparse page, so
 * N typed passes = N full scans. Walk 1 (no filter) handles everything; walk 2
 * (`type: account`, which stays dense) fills issuer/pool AccountRoot data once
 * pseudo-accounts are known.
 */
const WALK1_TYPES = new Set([
  "RippleState",
  "MPTokenIssuance",
  "MPToken",
  "NFTokenPage",
  "NFTokenOffer",
  "AMM",
  "Vault",
  "Oracle",
]);
const WALKS: { name: string; ledgerDataType?: string }[] = [
  { name: "walk1" },
  { name: "walk2", ledgerDataType: "account" },
];

export async function isSnapshotDone(db: Db): Promise<boolean> {
  const [row] = await db.select({ status: snapshotState.status }).from(snapshotState).limit(1);
  return row?.status === "done";
}

/**
 * One-time full state load via `ledger_data`. Idempotent + resumable: safe to
 * kill and restart (resumes from the persisted pass/marker). Never regresses
 * state that delta-processing already wrote (all inserts are DO NOTHING).
 * Does NOT advance `indexer_checkpoint` when one already exists — live sync then
 * resumes from exactly where it left off.
 */
export async function runSnapshot(db: Db): Promise<void> {
  let [st] = await db.select().from(snapshotState).limit(1);
  if (!st) {
    [st] = await db
      .insert(snapshotState)
      .values({ id: 1, status: "running", startedAt: new Date() })
      .returning();
  }
  if (st!.status === "done") return;

  const primary = new XrplClient({ endpoints: [...snapshotEndpoints], logger: createLogger("xrpl.snapshot") });
  await primary.connect();

  // Snapshot ledger: the checkpoint (state we've already delta-applied to), or
  // current validated for a fresh DB.
  let snapshotLedger = st!.snapshotLedger ?? undefined;
  if (!snapshotLedger) {
    const cp = await db.query.indexerCheckpoint.findFirst();
    if (cp) snapshotLedger = cp.lastLedgerSeq;
    else {
      const { ledger: l } = await primary.request<{ ledger: { ledger_index: number | string } }>({
        command: "ledger",
        ledger_index: "validated",
      });
      snapshotLedger = Number(l.ledger_index);
    }
  }

  // Which endpoint can serve that ledger's state?
  let src = primary;
  let extra: XrplClient | undefined;
  const historyDiffers =
    JSON.stringify([...backfillEndpoints].sort()) !== JSON.stringify([...snapshotEndpoints].sort());
  let probe = await src.ledgerData({ ledgerIndex: snapshotLedger, limit: 1 });
  if (probe.ledgerNotFound && historyDiffers) {
    log.warn({ snapshotLedger }, "sync node lacks this ledger's state — using full-history endpoints");
    extra = new XrplClient({ endpoints: [...backfillEndpoints], logger: createLogger("xrpl.snapshot.history") });
    await extra.connect();
    src = extra;
    probe = await src.ledgerData({ ledgerIndex: snapshotLedger, limit: 1 });
  }
  if (probe.ledgerNotFound) {
    await primary.disconnect();
    await extra?.disconnect();
    throw new Error(
      `snapshot: no endpoint serves ledger_data for ledger ${snapshotLedger}. ` +
        `Point XRPL_BACKFILL_ENDPOINTS at a full-history node, or drop the DB data + snapshot_state to snapshot at current.`,
    );
  }

  await db
    .update(snapshotState)
    .set({ status: "running", snapshotLedger, startedAt: st!.startedAt ?? new Date(), updatedAt: new Date() })
    .where(ONE);

  const registry = new Registry(db);
  await registry.init();
  const xrpTokenId = await registry.xrpTokenId(snapshotLedger);
  const completed = new Set<string>(safeJsonArray(st!.completedPasses));
  let total = st!.entriesProcessed ?? 0;

  log.info(
    {
      snapshotLedger,
      resuming: completed.size > 0 || total > 0 || st!.cursorMarker != null,
      completedPasses: [...completed],
      resumeFrom: st!.cursorType ? { pass: st!.cursorType, entries: total } : undefined,
    },
    "state snapshot starting",
  );

  for (const walk of WALKS) {
    if (completed.has(walk.name)) continue;
    // Marker to fetch from next. On resume this is a boundary that WAS flushed,
    // so re-fetching from it re-processes nothing (or, if the kill landed
    // between flush and marker-write, one flush-batch, harmlessly — DO NOTHING).
    let marker: unknown =
      st!.cursorType === walk.name && st!.cursorMarker ? JSON.parse(st!.cursorMarker) : undefined;

    // walk2 only keeps AccountRoots for issuers (blackholed/domain) + pool
    // pseudo-accounts (XRP reserve series) — the other ~6M are skipped.
    let issuerIds: Set<number> | undefined;
    if (walk.name === "walk2") {
      const rows = await db.execute<{ issuer_id: number }>(
        sql`select distinct issuer_id from token where issuer_id is not null`,
      );
      issuerIds = new Set([...rows].map((r) => Number(r.issuer_id)));
      log.info({ issuers: issuerIds.size }, "walk2: AccountRoots limited to issuers + pool accounts");
    }

    let batch = new LedgerBatch(snapshotLedger, { xrpTokenId, snapshot: true });
    let sinceFlush = 0;
    let pagesSinceFlush = 0;
    let pages = 0;
    let done = false;

    const fetch = (m: unknown) =>
      src.ledgerData({
        ledgerIndex: snapshotLedger,
        type: walk.ledgerDataType,
        marker: m,
        limit: PAGE_LIMIT,
      });
    let pending = fetch(marker);

    while (!done) {
      const page = await pending;
      const nextMarker = page.marker;
      done = nextMarker === undefined;
      if (!done) pending = fetch(nextMarker); // overlap next fetch with processing

      const wanted =
        walk.name === "walk2"
          ? page.state.filter((e) => {
              if (e.LedgerEntryType !== "AccountRoot") return false;
              const id = registry.cachedAccountId(String(e.Account));
              return id !== undefined && (issuerIds!.has(id) || registry.isPseudo(id));
            })
          : page.state.filter((e) => WALK1_TYPES.has(e.LedgerEntryType));

      pages++;
      pagesSinceFlush++;

      if (wanted.length > 0) {
        if (walk.name === "walk1") {
          await registry.bulkEnsureAccounts(pageAddresses(wanted), snapshotLedger);
          await warmRippleStateTokens(wanted, registry, snapshotLedger);
        }
        for (const entry of wanted) {
          await dispatch(entry, entry.LedgerEntryType, batch, registry, snapshotLedger);
          total++;
          sinceFlush++;
        }
      }

      if (sinceFlush >= FLUSH_EVERY || pagesSinceFlush >= 300 || done) {
        await batch.flush(db);
        batch = new LedgerBatch(snapshotLedger, { xrpTokenId, snapshot: true });
        sinceFlush = 0;
        pagesSinceFlush = 0;
        await db
          .update(snapshotState)
          .set({
            cursorType: walk.name,
            cursorMarker: done ? null : JSON.stringify(nextMarker),
            entriesProcessed: total,
            updatedAt: new Date(),
          })
          .where(ONE);
        log.info({ walk: walk.name, pages, total }, "snapshot progress");
      }
    }

    completed.add(walk.name);
    await db
      .update(snapshotState)
      .set({
        completedPasses: JSON.stringify([...completed]),
        cursorType: null,
        cursorMarker: null,
        entriesProcessed: total,
        updatedAt: new Date(),
      })
      .where(ONE);
    log.info({ walk: walk.name, total }, "snapshot walk complete");
  }

  await recomputeAllMetrics(db, snapshotLedger);

  await db
    .insert(ledger)
    .values({
      sequence: snapshotLedger,
      hash: "snapshot",
      parentHash: "snapshot",
      closeTime: new Date(),
      txnCount: 0,
    })
    .onConflictDoNothing();

  // Fresh DB only: seed the checkpoint so live sync resumes at snapshotLedger+1.
  const cp = await db.query.indexerCheckpoint.findFirst();
  if (!cp) {
    await db
      .insert(indexerCheckpoint)
      .values({ id: 1, lastLedgerSeq: snapshotLedger, lastLedgerHash: "snapshot" })
      .onConflictDoNothing();
  }

  await db
    .update(snapshotState)
    .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
    .where(ONE);

  await primary.disconnect();
  await extra?.disconnect();
  log.info({ snapshotLedger, total }, "state snapshot complete");
}

async function dispatch(
  entry: LedgerDataEntry,
  entryType: string,
  batch: LedgerBatch,
  registry: Registry,
  seq: number,
): Promise<void> {
  const node: NormalizedNode = {
    change: "created",
    entryType,
    ledgerIndex: String(entry.index),
    final: entry,
    prev: {},
  };
  switch (entryType) {
    case "RippleState":
      return handleRippleState(node, batch, registry, seq);
    case "MPTokenIssuance":
      return handleMptIssuance(node, batch, registry, seq);
    case "MPToken":
      return handleMpToken(node, batch, registry, seq);
    case "NFTokenPage":
      return snapshotNftPage(node, batch, registry, seq);
    case "NFTokenOffer":
      return snapshotNftOffer(node, batch, registry, seq);
    case "AMM":
      return handleAmm(node, batch, registry, seq);
    case "Vault":
      return handleVault(node, batch, registry, seq);
    case "Oracle":
      return handleOracle(node, batch, registry, seq);
    case "AccountRoot":
      return handleAccountRoot(node, batch, registry, seq, config.INDEXER_TRACK_XRP_BALANCES);
  }
}

/** One bulk holders/trustlines/supply point per token at the snapshot ledger. */
async function recomputeAllMetrics(db: Db, seq: number): Promise<void> {
  // Full distinct-on sort over the whole account_balance table blows the 30s
  // connection statement_timeout — run it once into a temp table with the
  // timeout lifted, then the three cheap aggregations read from that.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = 0`);
    // Avoid parallel workers — they allocate DSM in the container's small /dev/shm.
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    await tx.execute(sql`
      create temporary table _snap_agg on commit drop as
      with latest as (
        select distinct on (account_id, token_id) token_id, balance
        from account_balance
        order by account_id, token_id, ledger_seq desc
      )
      select token_id,
        count(*) filter (where balance <> 0) as trustlines,
        count(*) filter (where balance > 0)  as holders,
        coalesce(sum(balance) filter (where balance > 0), 0) as supply
      from latest group by token_id`);

    const xrp = sql`(select id from token where token_type = 'XRP' limit 1)`;
    await tx.execute(sql`
      insert into token_holders (token_id, ledger_seq, value)
      select token_id, ${seq}, holders from _snap_agg where token_id <> ${xrp}
      on conflict (token_id, ledger_seq) do update set value = excluded.value`);
    await tx.execute(sql`
      insert into token_trustlines (token_id, ledger_seq, value)
      select token_id, ${seq}, trustlines from _snap_agg where token_id <> ${xrp}
      on conflict (token_id, ledger_seq) do update set value = excluded.value`);
    await tx.execute(sql`
      insert into token_supply (token_id, ledger_seq, value)
      select token_id, ${seq}, supply from _snap_agg where token_id <> ${xrp}
      on conflict (token_id, ledger_seq) do update set value = excluded.value`);
  });
  log.info("snapshot metric recompute complete");
}

/** Every account address the entries will reference. */
function pageAddresses(entries: LedgerDataEntry[]): string[] {
  const out: string[] = [];
  const asObj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
  for (const e of entries) {
    switch (e.LedgerEntryType) {
      case "RippleState": {
        const lo = asObj(e.LowLimit)?.issuer;
        const hi = asObj(e.HighLimit)?.issuer;
        if (typeof lo === "string") out.push(lo);
        if (typeof hi === "string") out.push(hi);
        break;
      }
      case "AccountRoot":
      case "AMM":
      case "NFTokenOffer":
        pushStr(out, e.Account ?? e.Owner);
        break;
      case "MPTokenIssuance":
        pushStr(out, e.Issuer);
        break;
      case "MPToken": {
        pushStr(out, e.Account);
        try {
          out.push(parseMptIssuanceId(String(e.MPTokenIssuanceID)).issuer);
        } catch {
          /* skip */
        }
        break;
      }
      case "Vault":
        pushStr(out, e.Owner);
        pushStr(out, e.Account);
        break;
      case "Oracle":
        pushStr(out, e.Owner);
        break;
      case "NFTokenPage": {
        try {
          out.push(hexToAddress(String(e.index).slice(0, 40)));
        } catch {
          /* skip */
        }
        for (const t of (e.NFTokens as { NFToken?: { NFTokenID?: string } }[] | undefined) ?? []) {
          const id = t.NFToken?.NFTokenID;
          if (!id) continue;
          try {
            out.push(parseNftId(id).issuer);
          } catch {
            /* skip */
          }
        }
        break;
      }
    }
  }
  return out;
}

function pushStr(arr: string[], v: unknown): void {
  if (typeof v === "string" && v) arr.push(v);
}

/** Pre-resolve the (currency, issuer) IOU tokens a RippleState page references. */
async function warmRippleStateTokens(
  entries: LedgerDataEntry[],
  registry: Registry,
  seq: number,
): Promise<void> {
  const pairs: { currency: string; issuerId: number }[] = [];
  for (const e of entries) {
    if (e.LedgerEntryType !== "RippleState") continue;
    const bal = e.Balance as { currency?: string; value?: string } | undefined;
    const lo = e.LowLimit as { issuer?: string } | undefined;
    const hi = e.HighLimit as { issuer?: string } | undefined;
    if (!bal?.currency || !lo?.issuer || !hi?.issuer) continue;
    const issuerAddr = Number(bal.value ?? 0) < 0 ? lo.issuer : hi.issuer;
    const issuerId = registry.cachedAccountId(issuerAddr);
    if (issuerId !== undefined) pairs.push({ currency: currencyToString(bal.currency), issuerId });
  }
  await registry.bulkEnsureIouTokens(pairs, seq);
}

function safeJsonArray(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
