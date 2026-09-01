"use client";

import Link from "next/link";
import { CopyAddr } from "@/components/CopyAddr";
import { type Column, DataTable, type SetParam } from "@/components/DataTable";
import { num, shortAddr } from "@/lib/format";
import type { ListState } from "@/lib/list";
import type { TokenRow } from "@/lib/types";

const columns: Column<TokenRow>[] = [
  {
    key: "name",
    header: "Token",
    render: (t) => {
      const label = t.name ?? t.currency ?? t.mpt_issuance_id?.slice(0, 12) ?? "—";
      const href =
        t.token_type === "MPT" ? `/tokens/mpt:${t.mpt_issuance_id}` : `/tokens/${t.issuer}:${t.currency}`;
      return (
        <span className="flex items-center gap-2">
          <Link href={href} className="text-viz-1 hover:underline">
            {label}
          </Link>
          <span className="rounded bg-white/5 px-1 text-[10px] text-muted">{t.token_type}</span>
        </span>
      );
    },
  },
  { key: "", header: "Issuer", render: (t) => <CopyAddr addr={t.issuer} href={`/issuers/${t.issuer}`} /> },
  { key: "holders", header: "Holders", align: "right", render: (t) => num(t.holders) },
  { key: "trustlines", header: "Trustlines", align: "right", render: (t) => num(t.trustlines) },
  { key: "supply", header: "Supply", align: "right", render: (t) => num(t.supply, 2) },
  { key: "volume24h", header: "Vol 24h", align: "right", render: (t) => num(t.volume_24h, 2) },
  { key: "trades24h", header: "Trades 24h", align: "right", render: (t) => num(t.trades_24h) },
  { key: "", header: "Trust", align: "right", render: (t) => t.trust_level ?? 0 },
];

function Toolbar({ state, setParam }: { state: ListState; setParam: SetParam }) {
  const type = state.extra.type ?? "";
  const verified = state.extra.verified === "true";
  const chip = (val: string, label: string) => (
    <button
      type="button"
      key={label}
      onClick={() => setParam({ type: val || null })}
      className={`rounded px-2 py-1 text-xs ${type === val ? "bg-viz-1 text-black" : "text-muted hover:text-white"}`}
    >
      {label}
    </button>
  );
  const issuer = state.extra.issuer;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 rounded border border-panel-border p-0.5">
        {chip("", "All")}
        {chip("IOU", "IOU")}
        {chip("MPT", "MPT")}
      </div>
      <label className="flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setParam({ verified: e.target.checked ? "true" : null })}
        />
        Verified only
      </label>
      {issuer && (
        <button
          type="button"
          onClick={() => setParam({ issuer: null })}
          className="flex items-center gap-1 rounded border border-panel-border px-2 py-1 text-xs text-muted hover:text-white"
        >
          Issued by {shortAddr(issuer)} <span className="text-viz-1">✕</span>
        </button>
      )}
    </div>
  );
}

export function TokensTable({
  rows,
  total,
  state,
  pageSize,
}: {
  rows: TokenRow[];
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
      rowKey={(t) => t.id}
      searchPlaceholder="name, currency or issuer"
      toolbar={(setParam) => <Toolbar state={state} setParam={setParam} />}
    />
  );
}
