import { addressToHex, hexToAddress } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

/** Build the 48-hex MPTokenIssuanceID from its parts (XLS-33: sequence || issuer). */
function makeIssuanceId(sequence: number, issuerAddr: string): string {
  const seqHex = (sequence >>> 0).toString(16).padStart(8, "0").toUpperCase();
  return seqHex + addressToHex(issuerAddr);
}

/** MPTokenIssuance = the token definition (created/adjusted by the issuer). */
export async function handleMptIssuance(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const f = node.final;
  const issuerAddr = f.Issuer as string | undefined;
  const sequence = f.Sequence as number | undefined;
  if (!issuerAddr || sequence === undefined) return;

  const issuanceId =
    (f.mpt_issuance_id as string | undefined)?.toUpperCase() ?? makeIssuanceId(sequence, issuerAddr);

  const issuerId = await registry.accountId(issuerAddr, ledgerSeq);
  const tokenId = await registry.mptTokenId(issuanceId, issuerId, ledgerSeq);

  // The issuer's outstanding amount is the negative-supply anchor; we record it
  // as the issuer's own (negative) balance so supply math stays uniform.
  const outstanding = f.OutstandingAmount as string | number | undefined;
  if (outstanding !== undefined) {
    batch.balance(issuerId, tokenId, `-${String(outstanding)}`);
  }
}

/** MPToken = one account's holding of an MPT. */
export async function handleMpToken(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const f = node.final;
  const holderAddr = f.Account as string | undefined;
  const issuanceId = (f.MPTokenIssuanceID as string | undefined)?.toUpperCase();
  if (!holderAddr || !issuanceId) return;

  const amount = node.change === "deleted" ? "0" : String(f.MPTAmount ?? "0");

  // issuer id is embedded in the issuance id (last 20 bytes)
  const issuerHex = issuanceId.slice(8);
  const issuerId = await registry.accountId(hexToAddress(issuerHex), ledgerSeq);
  const holderId = await registry.accountId(holderAddr, ledgerSeq);
  const tokenId = await registry.mptTokenId(issuanceId, issuerId, ledgerSeq);

  batch.balance(holderId, tokenId, amount);
}
