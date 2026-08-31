import { createLogger } from "@xrpl-indexer/core/logger";
import { type Db, schema, sql } from "@xrpl-indexer/db";
import type { FullLedger } from "@xrpl-indexer/xrpl-client";
import { LedgerBatch } from "../batch.ts";
import type { Registry } from "../registry.ts";
import { normalizeAffectedNodes, txSucceeded } from "./affected-nodes.ts";
import { handleAccountRoot } from "./handlers/account.ts";
import { handleAmm } from "./handlers/amm.ts";
import { handleDexTrades } from "./handlers/dex.ts";
import { handleMpToken, handleMptIssuance } from "./handlers/mpt.ts";
import { handleNft } from "./handlers/nft.ts";
import { handleOracle } from "./handlers/oracle.ts";
import { handleRippleState } from "./handlers/trustline.ts";
import { handleVault } from "./handlers/vault.ts";

const { ledger, indexerCheckpoint } = schema;
const log = createLogger("indexer.process");

export interface ProcessResult {
  ledgerIndex: number;
  txnCount: number;
  touchedTokens: number;
}

export interface ProcessOptions {
  /** Record every account's native XRP balance history (see config). */
  trackXrpBalances: boolean;
}

/**
 * Apply one full ledger to Postgres in a single transaction. Idempotent:
 * re-running a ledger produces the same state (all writes are upserts keyed
 * by natural/ledger identifiers).
 */
export async function processLedger(
  full: FullLedger,
  db: Db,
  registry: Registry,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const seq = full.ledgerIndex;
  const xrpTokenId = await registry.xrpTokenId(seq);
  const batch = new LedgerBatch(seq, { xrpTokenId });

  for (const tx of full.transactions) {
    if (!txSucceeded(tx)) continue;
    const nodes = normalizeAffectedNodes(tx.meta);

    for (const node of nodes) {
      switch (node.entryType) {
        case "RippleState":
          await handleRippleState(node, batch, registry, seq);
          break;
        case "AccountRoot":
          await handleAccountRoot(node, batch, registry, seq, opts.trackXrpBalances);
          break;
        case "MPTokenIssuance":
          await handleMptIssuance(node, batch, registry, seq);
          break;
        case "MPToken":
          await handleMpToken(node, batch, registry, seq);
          break;
        case "AMM":
          await handleAmm(node, batch, registry, seq);
          break;
        case "Vault":
          await handleVault(node, batch, registry, seq);
          break;
        case "Oracle":
          await handleOracle(node, batch, registry, seq);
          break;
        default:
          break;
      }
    }

    // tx-level derivations that need the whole node set
    await handleDexTrades(tx, nodes, batch, registry, seq);
    if (touchesNft(nodes)) await handleNft(tx, nodes, batch, registry, seq);
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(ledger)
      .values({
        sequence: seq,
        hash: full.ledgerHash,
        parentHash: full.parentHash,
        closeTime: new Date(full.closeTimeIso),
        txnCount: full.transactions.length,
      })
      .onConflictDoUpdate({
        target: ledger.sequence,
        set: { hash: full.ledgerHash, indexedAt: sql`now()` },
      });

    await batch.flush(tx as unknown as Db);

    await tx
      .insert(indexerCheckpoint)
      .values({ id: 1, lastLedgerSeq: seq, lastLedgerHash: full.ledgerHash })
      .onConflictDoUpdate({
        target: indexerCheckpoint.id,
        set: {
          lastLedgerSeq: sql`greatest(${indexerCheckpoint.lastLedgerSeq}, excluded.last_ledger_seq)`,
          lastLedgerHash: sql`excluded.last_ledger_hash`,
          updatedAt: sql`now()`,
        },
      });
  });

  const result = { ledgerIndex: seq, txnCount: full.transactions.length, touchedTokens: batch.touchedTokens.size };
  log.debug(result, "ledger processed");
  return result;
}

function touchesNft(nodes: ReturnType<typeof normalizeAffectedNodes>): boolean {
  return nodes.some((n) => n.entryType === "NFTokenPage" || n.entryType === "NFTokenOffer");
}
