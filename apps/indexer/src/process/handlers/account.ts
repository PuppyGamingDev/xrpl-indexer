import { dropsToXrp, hexToUtf8 } from "@xrpl-indexer/codec";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

const LSF_DISABLE_MASTER = 0x00100000;

/**
 * AccountRoot carries the account's XRP balance, domain, flags, and — via the
 * absence of a RegularKey together with a disabled master key — a strong hint
 * that an issuer has been black-holed.
 */
export async function handleAccountRoot(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const f = node.final;
  const address = f.Account as string | undefined;
  if (!address) return;

  const accountId = await registry.accountId(address, ledgerSeq);

  if (node.change !== "deleted" && f.Balance !== undefined) {
    const xrpTokenId = await registry.xrpTokenId(ledgerSeq);
    batch.balance(accountId, xrpTokenId, dropsToXrp(String(f.Balance)));
  }

  const patch: Record<string, unknown> = {};
  if (typeof f.Flags === "number") {
    patch.flags = f.Flags;
    const masterDisabled = (f.Flags & LSF_DISABLE_MASTER) !== 0;
    const hasRegularKey = typeof f.RegularKey === "string" && f.RegularKey.length > 0;
    // TODO: also require an empty SignerList for a definitive black-hole verdict.
    patch.blackholed = masterDisabled && !hasRegularKey;
  }
  if (typeof f.Domain === "string") {
    try {
      patch.domain = hexToUtf8(f.Domain);
    } catch {
      /* leave domain unset on undecodable bytes */
    }
  }
  if (Object.keys(patch).length > 0) batch.patchAccount(accountId, patch);
}
