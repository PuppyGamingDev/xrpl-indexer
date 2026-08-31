import { hexToUtf8 } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

function safeHex(hex: unknown): string | null {
  if (typeof hex !== "string") return null;
  try {
    return hexToUtf8(hex);
  } catch {
    return null;
  }
}

/** Oracle (XLS-47) ledger entry. Key (LedgerIndex) is the oracle id. */
export async function handleOracle(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  if (node.change === "deleted") return;
  const f = node.final;
  const ownerAddr = f.Owner as string | undefined;
  if (!ownerAddr) return;

  const series = (f.PriceDataSeries as unknown[] | undefined) ?? [];

  batch.oracle({
    oracleId: node.ledgerIndex.toUpperCase(),
    ownerId: await registry.accountId(ownerAddr, ledgerSeq),
    provider: safeHex(f.Provider),
    assetClass: safeHex(f.AssetClass),
    uri: safeHex(f.URI),
    lastUpdateTime: f.LastUpdateTime !== undefined ? Number(f.LastUpdateTime) : null,
    priceDataCount: series.length,
    ledgerSeq,
  });
}
