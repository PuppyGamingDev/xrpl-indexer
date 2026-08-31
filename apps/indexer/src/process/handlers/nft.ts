import { hexToAddress, hexToUtf8, normalizeAmount, parseNftId, type XrplAmount } from "@xrpl-indexer/codec";
import type { ExpandedTransaction } from "@xrpl-indexer/xrpl-client";
import type { LedgerBatch } from "../../batch.ts";
import type { Registry } from "../../registry.ts";
import type { NormalizedNode } from "../affected-nodes.ts";

interface PageToken {
  NFToken?: { NFTokenID?: string; URI?: string };
}

/** Owner AccountID is the first 20 bytes of an NFTokenPage's key. */
function pageOwnerHex(ledgerIndex: string): string {
  return ledgerIndex.slice(0, 40);
}

function pageIds(fields: Record<string, unknown>): Map<string, string | undefined> {
  const arr = (fields.NFTokens as PageToken[] | undefined) ?? [];
  const m = new Map<string, string | undefined>();
  for (const t of arr) {
    const id = t.NFToken?.NFTokenID;
    if (id) m.set(id.toUpperCase(), t.NFToken?.URI);
  }
  return m;
}

function safeHexToUtf8(hex: string): string | undefined {
  try {
    return hexToUtf8(hex);
  } catch {
    return undefined;
  }
}

/**
 * Reconstruct NFT ownership + lifecycle from NFTokenPage diffs and NFTokenOffer
 * nodes — uniform across Mint / Burn / CreateOffer / CancelOffer / AcceptOffer.
 */
export async function handleNft(
  tx: ExpandedTransaction,
  nodes: NormalizedNode[],
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const txType = (tx.tx as { TransactionType?: string }).TransactionType;
  const txHash = tx.tx.hash;

  // ---- ownership via NFTokenPage diffs ----
  for (const node of nodes) {
    if (node.entryType !== "NFTokenPage") continue;
    const ownerAddr = hexToAddress(pageOwnerHex(node.ledgerIndex));
    const before = pageIds(node.prev);
    const after = node.change === "deleted" ? new Map<string, string | undefined>() : pageIds(node.final);

    for (const [id, uriHex] of after) {
      if (before.has(id)) continue;
      await upsertNftFull(id, ownerAddr, uriHex, batch, registry, ledgerSeq, txType === "NFTokenMint");
    }
    for (const [id] of before) {
      if (after.has(id)) continue;
      if (txType === "NFTokenBurn") {
        await ensureNftStub(id, batch, registry, ledgerSeq);
        batch.nft({ tokenId: id, issuerId: await issuerIdOf(id, registry, ledgerSeq), taxon: taxonOf(id), serial: serialOf(id), burnLedgerSeq: ledgerSeq, live: false });
      }
      // non-burn removals are moves; the receiving page handles the add
    }
  }

  // ---- offers + sales via NFTokenOffer nodes ----
  let saleIdx = 0;
  for (const node of nodes) {
    if (node.entryType !== "NFTokenOffer") continue;
    const f = node.final;
    const offerId = node.ledgerIndex.toUpperCase();
    const nftId = (f.NFTokenID as string | undefined)?.toUpperCase();
    const ownerAddr = f.Owner as string | undefined;
    if (!nftId || !ownerAddr) continue;

    await ensureNftStub(nftId, batch, registry, ledgerSeq);

    const isSell = (((f.Flags as number | undefined) ?? 0) & 1) === 1;
    const amount = normalizeAmount((f.Amount as XrplAmount) ?? "0");
    const accountId = await registry.accountId(ownerAddr, ledgerSeq);

    if (node.change === "created") {
      batch.nftOffer({ offerId, nftTokenId: nftId, accountId, amount, isSell, createdLedgerSeq: ledgerSeq });
    } else if (node.change === "deleted") {
      batch.nftOffer({
        offerId,
        nftTokenId: nftId,
        accountId,
        amount,
        isSell,
        createdLedgerSeq: ledgerSeq,
        closedLedgerSeq: ledgerSeq,
      });
      if (txType === "NFTokenAcceptOffer" && txHash) {
        const taker = (tx.tx as { Account?: string }).Account;
        const buyerAddr = isSell ? taker : ownerAddr;
        const sellerAddr = isSell ? ownerAddr : taker;
        batch.nftExchange({
          txHash,
          idx: saleIdx++,
          nftTokenId: nftId,
          sellerId: sellerAddr ? await registry.accountId(sellerAddr, ledgerSeq) : null,
          buyerId: buyerAddr ? await registry.accountId(buyerAddr, ledgerSeq) : null,
          amount,
          ledgerSeq,
        });
      }
    }
  }
}

function taxonOf(id: string): number {
  try {
    return parseNftId(id).taxon;
  } catch {
    return 0;
  }
}
function serialOf(id: string): number {
  try {
    return parseNftId(id).sequence;
  } catch {
    return 0;
  }
}
async function issuerIdOf(id: string, registry: Registry, ledgerSeq: number): Promise<number> {
  const p = parseNftId(id);
  return registry.accountId(p.issuer, ledgerSeq);
}

/** Insert a minimal `nft` row (issuer/taxon/serial from the id) if none exists. */
async function ensureNftStub(
  tokenId: string,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  let issuerId: number;
  let taxon = 0;
  let serial = 0;
  let flags = 0;
  let transferFee = 0;
  try {
    const p = parseNftId(tokenId);
    issuerId = await registry.accountId(p.issuer, ledgerSeq);
    taxon = p.taxon;
    serial = p.sequence;
    flags = p.flags;
    transferFee = p.transferFee;
  } catch {
    return; // unparseable id — skip, FK will simply not be satisfiable
  }
  const collectionId = await registry.collectionId(issuerId, taxon, ledgerSeq);
  batch.nft({ tokenId, issuerId, taxon, serial, flags, transferFee, collectionId, live: true });
}

async function upsertNftFull(
  tokenId: string,
  ownerAddr: string,
  uriHex: string | undefined,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
  isMint: boolean,
): Promise<void> {
  const ownerId = await registry.accountId(ownerAddr, ledgerSeq);
  let issuerId = ownerId;
  let taxon = 0;
  let serial = 0;
  let flags = 0;
  let transferFee = 0;
  try {
    const p = parseNftId(tokenId);
    issuerId = await registry.accountId(p.issuer, ledgerSeq);
    taxon = p.taxon;
    serial = p.sequence;
    flags = p.flags;
    transferFee = p.transferFee;
  } catch {
    /* keep defaults */
  }
  const collectionId = await registry.collectionId(issuerId, taxon, ledgerSeq);

  batch.nft({
    tokenId,
    issuerId,
    ownerId,
    collectionId,
    taxon,
    serial,
    flags,
    transferFee,
    uri: uriHex ? safeHexToUtf8(uriHex) : undefined,
    mintLedgerSeq: isMint ? ledgerSeq : undefined,
    live: true,
  });
}

// ---------------------------------------------------------------------------
// Snapshot entrypoints — fed synthetic "created" nodes from `ledger_data`.
// ---------------------------------------------------------------------------

/** An NFTokenPage from `ledger_data`: every NFT it lists is owned by the page owner. */
export async function snapshotNftPage(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const ownerAddr = hexToAddress(pageOwnerHex(node.ledgerIndex));
  for (const [id, uriHex] of pageIds(node.final)) {
    await upsertNftFull(id, ownerAddr, uriHex, batch, registry, ledgerSeq, false);
  }
}

/** An NFTokenOffer from `ledger_data`: a live (open) offer. */
export async function snapshotNftOffer(
  node: NormalizedNode,
  batch: LedgerBatch,
  registry: Registry,
  ledgerSeq: number,
): Promise<void> {
  const f = node.final;
  const nftId = (f.NFTokenID as string | undefined)?.toUpperCase();
  const ownerAddr = f.Owner as string | undefined;
  if (!nftId || !ownerAddr) return;
  await ensureNftStub(nftId, batch, registry, ledgerSeq);
  batch.nftOffer({
    offerId: node.ledgerIndex.toUpperCase(),
    nftTokenId: nftId,
    accountId: await registry.accountId(ownerAddr, ledgerSeq),
    amount: normalizeAmount((f.Amount as XrplAmount) ?? "0"),
    isSell: (((f.Flags as number | undefined) ?? 0) & 1) === 1,
    createdLedgerSeq: ledgerSeq,
  });
}
