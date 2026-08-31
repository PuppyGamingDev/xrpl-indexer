import { currencyToString } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

interface AmountObj {
  currency: string;
  issuer: string;
  value: string;
}

/**
 * RippleState = one bilateral trustline. `Balance.value` is signed from the
 * low account's perspective: >= 0 means the low account holds the IOU issued
 * by the high account; < 0 means the reverse.
 */
export async function handleRippleState(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const f = node.final;
  const balance = f.Balance as AmountObj | undefined;
  const lowLimit = f.LowLimit as AmountObj | undefined;
  const highLimit = f.HighLimit as AmountObj | undefined;
  if (!balance || !lowLimit || !highLimit) return;

  const currency = currencyToString(balance.currency);
  const lowAddr = lowLimit.issuer;
  const highAddr = highLimit.issuer;

  // On deletion the trustline is gone -> holder balance is zero.
  const raw = node.change === "deleted" ? "0" : (balance.value ?? "0");
  const sign = Number(raw);

  const issuerAddr = sign < 0 ? lowAddr : highAddr;
  const holderAddr = sign < 0 ? highAddr : lowAddr;
  const holderBalance = sign < 0 ? stripLeadingMinus(raw) : raw;

  const issuerId = await registry.accountId(issuerAddr, ledgerSeq);
  const holderId = await registry.accountId(holderAddr, ledgerSeq);
  const tokenId = await registry.iouTokenId(currency, issuerId, ledgerSeq);

  batch.balance(holderId, tokenId, holderBalance);
}

function stripLeadingMinus(v: string): string {
  return v.startsWith("-") ? v.slice(1) : `-${v}`;
}
