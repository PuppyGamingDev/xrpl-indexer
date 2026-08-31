import { currencyToString } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

interface AssetSpec {
  currency: string;
  issuer?: string;
}

/** Vault (XLS-65) ledger entry. Key (LedgerIndex) is the vault id. */
export async function handleVault(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  if (node.change === "deleted") return;
  const f = node.final;
  const ownerAddr = f.Owner as string | undefined;
  if (!ownerAddr) return;

  const asset = f.Asset as AssetSpec | undefined;
  const assetTokenId = !asset
    ? await registry.xrpTokenId(ledgerSeq)
    : !asset.issuer
      ? await registry.xrpTokenId(ledgerSeq)
      : await registry.iouTokenId(
          currencyToString(asset.currency),
          await registry.accountId(asset.issuer, ledgerSeq),
          ledgerSeq,
        );

  const pseudoAddr = f.Account as string | undefined;
  const pseudoAccountId = pseudoAddr ? await registry.accountId(pseudoAddr, ledgerSeq) : null;
  if (pseudoAccountId !== null) {
    registry.markPseudo(pseudoAccountId);
    batch.patchAccount(pseudoAccountId, { pseudo: true, pseudoSource: "vault" });
  }

  batch.vault({
    vaultId: node.ledgerIndex.toUpperCase(),
    ownerId: await registry.accountId(ownerAddr, ledgerSeq),
    pseudoAccountId,
    assetTokenId,
    shareMptId: (f.MPTokenIssuanceID as string | undefined)?.toUpperCase() ?? null,
    assetsTotal: f.AssetsTotal !== undefined ? String(f.AssetsTotal) : null,
    assetsAvailable: f.AssetsAvailable !== undefined ? String(f.AssetsAvailable) : null,
    assetsMaximum: f.AssetsMaximum !== undefined ? String(f.AssetsMaximum) : null,
    flags: Number(f.Flags ?? 0),
    ledgerSeq,
  });
}
