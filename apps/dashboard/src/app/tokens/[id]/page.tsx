import { notFound } from "next/navigation";
import { CopyAddr } from "@/components/CopyAddr";
import { Sparkline } from "@/components/Sparkline";
import { Crumb, Panel, StatCard, Table } from "@/components/ui";
import { api, apiSafe, ApiError } from "@/lib/api";
import { num, pct, shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Detail {
  tokenType: string;
  currency: string | null;
  issuer: string;
  mptIssuanceId: string | null;
  blackholed: boolean;
  issuerPseudo: boolean;
  holders: number;
  trustlines: number;
  supply: string;
  priceXrp: string | null;
  meta: { name?: string; domain?: string; trust_level?: number; icon_uri?: string } | null;
}
interface Holders {
  totalHolders: number;
  totalSupply: string;
  holders: { account: string; balance: string; percent: number; pool: boolean }[];
}
interface Series {
  series: { ledgerSequence: number; value: string | null }[];
}

export default async function TokenDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const isMpt = id.startsWith("mpt:");
  const base = isMpt ? `/mpts/${id.slice(4)}` : `/tokens/${id.split(":")[0]}/${id.split(":").slice(1).join(":")}`;

  let detail: Detail;
  try {
    detail = await api<Detail>(base);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [holders, series] = await Promise.all([
    apiSafe<Holders>(`${base}/holders?limit=15`),
    apiSafe<Series>(`${base}/series/holders?points=40`),
  ]);

  const name = detail.meta?.name ?? detail.currency ?? detail.mptIssuanceId?.slice(0, 16) ?? "token";
  const spark = (series?.series ?? [])
    .filter((p) => p.value != null)
    .map((p) => ({ x: p.ledgerSequence, y: Number(p.value) }));

  return (
    <div className="space-y-6">
      <Crumb items={[{ href: "/tokens", label: "Tokens" }, { label: name }]} />
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{name}</h1>
        <span className="rounded bg-panel-border px-2 py-0.5 text-xs">{detail.tokenType}</span>
        {detail.blackholed && <span className="rounded bg-viz-2/20 px-2 py-0.5 text-xs text-viz-2">blackholed</span>}
        {detail.issuerPseudo && <span className="rounded bg-viz-5/20 px-2 py-0.5 text-xs text-viz-5">pool</span>}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <CopyAddr addr={detail.issuer} href={`/issuers/${detail.issuer}`} />
        {detail.meta?.domain ? <span>· {detail.meta.domain}</span> : null}
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Holders" value={num(detail.holders)} />
        <StatCard label="Trustlines" value={num(detail.trustlines)} />
        <StatCard label="Supply" value={num(detail.supply, 2)} />
        <StatCard label="Price (XRP)" value={detail.priceXrp ? Number(detail.priceXrp).toPrecision(4) : "—"} />
      </div>

      <Panel title="Holders over time">
        <Sparkline data={spark} height={120} color="var(--color-viz-1)" />
      </Panel>

      <Panel title={`Top holders (${num(holders?.totalHolders ?? 0)})`}>
        <Table head={["Account", "Balance", "Share", ""]}>
          {(holders?.holders ?? []).map((h) => (
            <tr key={h.account}>
              <td className="py-2 pr-4 font-mono text-xs">{shortAddr(h.account)}</td>
              <td className="py-2 pr-4 tabular-nums">{num(h.balance, 2)}</td>
              <td className="py-2 pr-4 tabular-nums">{pct(h.percent, 100)}</td>
              <td className="py-2">{h.pool && <span className="text-xs text-viz-5">pool</span>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
