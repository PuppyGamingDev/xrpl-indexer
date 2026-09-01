"use client";

import Link from "next/link";
import { CopyAddr } from "@/components/CopyAddr";
import { type Column, DataTable, type SetParam } from "@/components/DataTable";
import { num } from "@/lib/format";
import type { ListState } from "@/lib/list";
import type { CollectionRow } from "@/lib/types";

const columns: Column<CollectionRow>[] = [
  {
    key: "name",
    header: "Collection",
    render: (c) => (
      <Link
        href={`/nfts/collections/${c.issuer}/${c.taxon}`}
        className="text-viz-1 hover:underline"
      >
        {c.name ?? `Collection ${c.id}`}
      </Link>
    ),
  },
  { key: "", header: "Issuer", render: (c) => <CopyAddr addr={c.issuer} /> },
  { key: "", header: "Taxon", align: "right", render: (c) => c.taxon },
  { key: "supply", header: "Supply", align: "right", render: (c) => num(c.live_supply || c.supply) },
  { key: "holders", header: "Holders", align: "right", render: (c) => num(c.holders) },
  { key: "volume24h", header: "Vol 24h", align: "right", render: (c) => num(c.volume_24h, 2) },
  { key: "volumeAll", header: "Vol all", align: "right", render: (c) => num(c.volume_all, 2) },
  { key: "trades24h", header: "Trades 24h", align: "right", render: (c) => num(c.trades_24h) },
];

function Toolbar({ state, setParam }: { state: ListState; setParam: SetParam }) {
  const named = state.extra.named === "true";
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      <input
        type="checkbox"
        checked={named}
        onChange={(e) => setParam({ named: e.target.checked ? "true" : null })}
      />
      Named only
    </label>
  );
}

export function CollectionsTable({
  rows,
  total,
  state,
  pageSize,
}: {
  rows: CollectionRow[];
  total: number;
  state: ListState;
  pageSize: number;
}) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      total={total}
      state={state}
      pageSize={pageSize}
      rowKey={(c) => c.id}
      searchPlaceholder="collection name or issuer"
      toolbar={(setParam) => <Toolbar state={state} setParam={setParam} />}
    />
  );
}
