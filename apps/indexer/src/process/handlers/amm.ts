import { currencyToString } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

interface AssetSpec {
  currency: string;
  issuer?: string;
}

async function assetToTokenId(
  asset: AssetSpec | undefined,
  registry: Registry,
  ledgerSeq: number,
): Promise<number | null> {
  if (!asset) return null;
  if (!asset.issuer && (asset.currency === "XRP" || /^0{40}$/.test(asset.currency))) {
    return registry.xrpTokenId(ledgerSeq);
  }
  if (!asset.issuer) return null;
  const issuerId = await registry.accountId(asset.issuer, ledgerSeq);
  return registry.iouTokenId(currencyToString(asset.currency), issuerId, ledgerSeq);
}

/** AMM ledger entry. Reserves are captured via the pseudo-account's balances. */
export async function handleAmm(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  if (node.change === "deleted") return;
  const f = node.final;
  const pseudoAddr = f.Account as string | undefined;
  if (!pseudoAddr) return;

  const accountId = await registry.accountId(pseudoAddr, ledgerSeq);
  const asset1 = await assetToTokenId(f.Asset as AssetSpec, registry, ledgerSeq);
  const asset2 = await assetToTokenId(f.Asset2 as AssetSpec, registry, ledgerSeq);
  if (asset1 === null || asset2 === null) return;

  const lp = f.LPTokenBalance as { currency?: string } | undefined;

  batch.patchAccount(accountId, { pseudo: true, pseudoSource: "amm" });
  batch.amm({
    accountId,
    asset1TokenId: asset1,
    asset2TokenId: asset2,
    lpTokenCurrency: lp?.currency ? currencyToString(lp.currency) : "",
    tradingFee: Number(f.TradingFee ?? 0),
    createdLedgerSeq: ledgerSeq,
  });
}
