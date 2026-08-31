import { hexToAddress, normalizeAmount, type XrplAmount } from "@xrpl-indexer/codec";
import type { ExpandedTransaction } from "@xrpl-indexer/xrpl-client";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

/**
 * Derive DEX trades from the `Offer` nodes an OfferCreate / Payment consumed.
 * Each consumed offer node is one fill between the transaction sender (taker)
 * and the offer owner (maker).
 */
export async function handleDexTrades(
  tx: ExpandedTransaction,
  nodes: NormalizedNode[],
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const txHash = tx.tx.hash;
  const takerAddr = (tx.tx as { Account?: string }).Account;
  if (!txHash || !takerAddr) return;
  const takerId = await registry.accountId(takerAddr, ledgerSeq);

  let idx = 0;
  for (const node of nodes) {
    if (node.entryType !== "Offer") continue;
    if (node.change === "created") continue; // a resting offer, not a fill

    const makerAddr = node.final.Account as string | undefined;
    if (!makerAddr) continue;

    const paysDelta = amountDelta(node.prev.TakerPays, node.final.TakerPays, node.change);
    const getsDelta = amountDelta(node.prev.TakerGets, node.final.TakerGets, node.change);
    if (!paysDelta || !getsDelta) continue;
    if (isZero(paysDelta.value) && isZero(getsDelta.value)) continue;

    const makerId = await registry.accountId(makerAddr, ledgerSeq);
    const takerPaid = await resolveAsset(paysDelta.amount, registry, ledgerSeq);
    const takerGot = await resolveAsset(getsDelta.amount, registry, ledgerSeq);
    if (!takerPaid || !takerGot) continue;

    batch.tokenExchange({
      txHash,
      idx: idx++,
      ledgerSeq,
      takerPaidTokenId: takerPaid.tokenId,
      takerPaidValue: paysDelta.value,
      takerGotTokenId: takerGot.tokenId,
      takerGotValue: getsDelta.value,
      takerId,
      makerId,
    });
  }
}

interface Delta {
  amount: XrplAmount;
  value: string;
}

function amountDelta(prev: unknown, final: unknown, change: NormalizedNode["change"]): Delta | null {
  const ref = (prev ?? final) as XrplAmount | undefined;
  if (ref === undefined) return null;
  const p = prev !== undefined ? Number(normalizeAmount(prev as XrplAmount).value) : 0;
  const fRaw = change === "deleted" ? 0 : final !== undefined ? Number(normalizeAmount(final as XrplAmount).value) : p;
  const diff = Math.abs(p - fRaw);
  return { amount: ref, value: String(diff) };
}

async function resolveAsset(
  amount: XrplAmount,
  registry: Registry,
  ledgerSeq: number,
): Promise<{ tokenId: number } | null> {
  const n = normalizeAmount(amount);
  if (n.kind === "xrp") return { tokenId: await registry.xrpTokenId(ledgerSeq) };
  if (n.kind === "iou" && n.currency && n.issuer) {
    const issuerId = await registry.accountId(n.issuer, ledgerSeq);
    return { tokenId: await registry.iouTokenId(n.currency, issuerId, ledgerSeq) };
  }
  if (n.kind === "mpt" && n.mptIssuanceId) {
    const issuerHex = n.mptIssuanceId.slice(8);
    const issuerId = await registry.accountId(hexToAddress(issuerHex), ledgerSeq);
    return { tokenId: await registry.mptTokenId(n.mptIssuanceId, issuerId, ledgerSeq) };
  }
  return null;
}

function isZero(v: string): boolean {
  return Number(v) === 0;
}
