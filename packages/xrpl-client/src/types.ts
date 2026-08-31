import type { LedgerEntry, Transaction, TransactionMetadata } from "xrpl";

/** A validated-ledger notification from the `ledger` stream. */
export interface ValidatedLedger {
  ledgerIndex: number;
  ledgerHash: string;
  parentHash: string;
  closeTimeRipple: number;
  txnCount: number;
  /** Reserve/fee context, when the stream provides it. */
  reserveBaseDrops?: number;
  reserveIncDrops?: number;
}

/** One entry of a full ledger fetched with `transactions: true, expand: true`. */
export interface ExpandedTransaction {
  /** The submitted transaction, including `hash`. */
  tx: Transaction & { hash: string; ledger_index?: number };
  /** Full transaction metadata (AffectedNodes, delivered_amount, ...). */
  meta: TransactionMetadata;
  validated: boolean;
}

export interface FullLedger {
  ledgerIndex: number;
  ledgerHash: string;
  parentHash: string;
  closeTimeRipple: number;
  closeTimeIso: string;
  transactions: ExpandedTransaction[];
}

export type { LedgerEntry, Transaction, TransactionMetadata };
