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
 * ledger_data passes, in order. `account` (AccountRoot) runs last so AMM/Vault
 * pseudo-accounts are already known and their XRP reserves get recorded even
 * when INDEXER_TRACK_XRP_BALANCES is off.
 */
const PASSES: { type: string; entryType: string }[] = [
  { type: "state", entryType: "RippleState" },
  { type: "mpt_issuance", entryType: "MPTokenIssuance" },
  { type: "mptoken", entryType: "MPToken" },
  { type: "nft_page", entryType: "NFTokenPage" },
  { type: "nft_offer", entryType: "NFTokenOffer" },
  { type: "amm", entryType: "AMM" },
  { type: "vault", entryType: "Vault" },
  { type: "oracle", entryType: "Oracle" },
  { type: "account", entryType: "AccountRoot" },
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

  for (const pass of PASSES) {
    if (completed.has(pass.type)) continue;
    // Marker to fetch from next. On resume this is a boundary that WAS flushed,
    // so re-fetching from it re-processes nothing (or, if the kill landed
    // between flush and marker-write, one flush-batch, harmlessly — DO NOTHING).
    let marker: unknown =
      st!.cursorType === pass.type && st!.cursorMarker ? JSON.parse(st!.cursorMarker) : undefined;

    // The AccountRoot pass would otherwise touch every ~6M accounts. We only
    // need issuers (for `blackholed`/`domain`) and pool pseudo-accounts (for
    // XRP reserve series) — everything else is skipped.
    let issuerIds: Set<number> | undefined;
    if (pass.entryType === "AccountRoot") {
      const rows = await db.execute<{ issuer_id: number }>(
        sql`select distinct issuer_id from token where issuer_id is not null`,
      );
      issuerIds = new Set([...rows].map((r) => Number(r.issuer_id)));
      log.info({ issuers: issuerIds.size }, "AccountRoot pass limited to issuers + pool accounts");
    }

    let batch = new LedgerBatch(snapshotLedger, { xrpTokenId, snapshot: true });
    let sinceFlush = 0;
    let pagesSinceFlush = 0;
    let pages = 0;
    let done = false;

    const fetch = (m: unknown) =>
      src.ledgerData({ ledgerIndex: snapshotLedger, type: pass.type, marker: m, limit: PAGE_LIMIT });
    let pending = fetch(marker);

    while (!done) {
      const page = await pending;
      const nextMarker = page.marker;
      done = nextMarker === undefined;
      // Kick off the next fetch before processing this page (overlaps network + DB).
      if (!done) pending = fetch(nextMarker);
      pages++;
      pagesSinceFlush++;

      if (pass.entryType === "AccountRoot") {
        for (const entry of page.state) {
          if (entry.LedgerEntryType !== "AccountRoot") continue;
          const id = registry.cachedAccountId(String(entry.Account));
          if (id === undefined || !(issuerIds!.has(id) || registry.isPseudo(id))) continue;
          await dispatch(entry, "AccountRoot", batch, registry, snapshotLedger);
          total++;
          sinceFlush++;
        }
      } else {
        await registry.bulkEnsureAccounts(pageAddresses(page.state, pass.entryType), snapshotLedger);
        if (pass.entryType === "RippleState") {
          await warmRippleStateTokens(page.state, registry, snapshotLedger);
        }
        for (const entry of page.state) {
          if (entry.LedgerEntryType !== pass.entryType) continue;
          await dispatch(entry, pass.entryType, batch, registry, snapshotLedger);
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
            cursorType: pass.type,
            cursorMarker: done ? null : JSON.stringify(nextMarker),
            entriesProcessed: total,
            updatedAt: new Date(),
          })
          .where(ONE);
        log.info({ pass: pass.type, pages, total }, "snapshot progress");
      }
    }

    completed.add(pass.type);
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
    log.info({ pass: pass.type, total }, "snapshot pass complete");
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
  const base = sql`
    with latest as (
      select distinct on (account_id, token_id) token_id, balance
      from account_balance
      order by account_id, token_id, ledger_seq desc
    ),
    agg as (
      select token_id,
        count(*) filter (where balance <> 0)::text as trustlines,
        count(*) filter (where balance > 0)::text  as holders,
        coalesce(sum(balance) filter (where balance > 0), 0)::text as supply
      from latest group by token_id
    )`;
  const xrp = sql`(select id from token where token_type = 'XRP' limit 1)`;

  await db.execute(sql`${base}
    insert into token_holders (token_id, ledger_seq, value)
    select token_id, ${seq}, holders from agg where token_id <> ${xrp}
    on conflict (token_id, ledger_seq) do update set value = excluded.value`);
  await db.execute(sql`${base}
    insert into token_trustlines (token_id, ledger_seq, value)
    select token_id, ${seq}, trustlines from agg where token_id <> ${xrp}
    on conflict (token_id, ledger_seq) do update set value = excluded.value`);
  await db.execute(sql`${base}
    insert into token_supply (token_id, ledger_seq, value)
    select token_id, ${seq}, supply from agg where token_id <> ${xrp}
    on conflict (token_id, ledger_seq) do update set value = excluded.value`);
  log.info("snapshot metric recompute complete");
}

/** Every account address the entries in a page will reference. */
function pageAddresses(entries: LedgerDataEntry[], entryType: string): string[] {
  const out: string[] = [];
  const asObj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
  for (const e of entries) {
    if (e.LedgerEntryType !== entryType) continue;
    switch (entryType) {
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
