import Link from "next/link";
import { Panel, Table } from "@/components/ui";
import { api } from "@/lib/api";
import { num, shortAddr } from "@/lib/format";
import type { TokenRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const SORTS = ["holders", "trustlines", "supply"] as const;

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<{ sortBy?: string }>;
}) {
  const { sortBy = "holders" } = await searchParams;
  const { tokens } = await api<{ tokens: TokenRow[] }>(`/tokens?limit=100&sortBy=${sortBy}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tokens</h1>
        <div className="flex gap-2 text-sm">
          {SORTS.map((s) => (
            <Link
              key={s}
              href={`/tokens?sortBy=${s}`}
              className={`rounded px-2 py-1 ${s === sortBy ? "bg-viz-1 text-black" : "text-muted hover:text-white"}`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <Panel>
        <Table head={["Token", "Issuer", "Holders", "Trustlines", "Supply", "Trust"]}>
          {tokens.map((t) => {
            const label = t.name ?? t.currency ?? t.mpt_issuance_id?.slice(0, 12) ?? "—";
            const href =
              t.token_type === "MPT"
                ? `/tokens/mpt:${t.mpt_issuance_id}`
                : `/tokens/${t.issuer}:${t.currency}`;
            return (
              <tr key={t.id} className="hover:bg-white/5">
                <td className="py-2 pr-4">
                  <Link href={href} className="text-viz-1 hover:underline">
                    {label}
                  </Link>
                  <span className="ml-2 text-xs text-muted">{t.token_type}</span>
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(t.issuer)}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.holders)}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.trustlines)}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.supply, 2)}</td>
                <td className="py-2 pr-4 tabular-nums">{t.trust_level ?? 0}</td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}
