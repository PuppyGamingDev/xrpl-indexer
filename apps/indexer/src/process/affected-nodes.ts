import type { ExpandedTransaction, TransactionMetadata } from "@xrpl-indexer/xrpl-client";

export type NodeChange = "created" | "modified" | "deleted";

export interface NormalizedNode {
  change: NodeChange;
  entryType: string;
  ledgerIndex: string;
  /** Post-transaction state (for deleted: the fields present at deletion). */
  final: Record<string, unknown>;
  /** Pre-transaction state (empty for created). */
  prev: Record<string, unknown>;
}

/** Flatten a transaction's `meta.AffectedNodes` into a uniform list. */
export function normalizeAffectedNodes(meta: TransactionMetadata | undefined): NormalizedNode[] {
  const nodes = (meta as { AffectedNodes?: unknown[] } | undefined)?.AffectedNodes ?? [];
  const out: NormalizedNode[] = [];
  for (const raw of nodes) {
    const n = raw as Record<string, Record<string, unknown>>;
    if (n.CreatedNode) {
      const c = n.CreatedNode;
      out.push({
        change: "created",
        entryType: String(c.LedgerEntryType),
        ledgerIndex: String(c.LedgerIndex),
        final: (c.NewFields as Record<string, unknown>) ?? {},
        prev: {},
      });
    } else if (n.ModifiedNode) {
      const m = n.ModifiedNode;
      out.push({
        change: "modified",
        entryType: String(m.LedgerEntryType),
        ledgerIndex: String(m.LedgerIndex),
        final: {
          ...((m.PreviousFields as Record<string, unknown>) ?? {}),
          ...((m.FinalFields as Record<string, unknown>) ?? {}),
        },
        prev: (m.PreviousFields as Record<string, unknown>) ?? {},
      });
    } else if (n.DeletedNode) {
      const d = n.DeletedNode;
      out.push({
        change: "deleted",
        entryType: String(d.LedgerEntryType),
        ledgerIndex: String(d.LedgerIndex),
        final: (d.FinalFields as Record<string, unknown>) ?? {},
        prev: (d.PreviousFields as Record<string, unknown>) ?? {},
      });
    }
  }
  return out;
}

export function nodesByType(nodes: NormalizedNode[], entryType: string): NormalizedNode[] {
  return nodes.filter((n) => n.entryType === entryType);
}

export function txSucceeded(tx: ExpandedTransaction): boolean {
  const code = (tx.meta as { TransactionResult?: string } | undefined)?.TransactionResult;
  return code === "tesSUCCESS";
}
