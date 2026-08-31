import { notFound } from "next/navigation";
import { Crumb, Panel, StatCard, Table } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { num, shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Col {
  id: string;
  issuer: string;
  taxon: string;
  name: string | null;
  image_uri: string | null;
  holders: number | null;
  floor: string | null;
  volume_all: string | null;
  live_supply: number;
  total_supply: number;
}
interface Nft {
  token_id: string;
  serial: string;
  name: string | null;
  image_uri: string | null;
  owner: string | null;
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ issuer: string; taxon: string }>;
}) {
  const { issuer, taxon } = await params;
  let col: Col;
  try {
    col = await api<Col>(`/collections/${issuer}/${taxon}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { nfts } = await api<{ nfts: Nft[] }>(`/collections/${issuer}/${taxon}/nfts?limit=48`);

  return (
    <div className="space-y-6">
      <Crumb items={[{ href: "/nfts/collections", label: "Collections" }, { label: col.name ?? `#${col.id}` }]} />
      <h1 className="text-xl font-semibold">{col.name ?? `Collection ${col.id}`}</h1>
      <p className="font-mono text-xs text-muted">
        {shortAddr(col.issuer)} · taxon {col.taxon}
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Live supply" value={num(col.live_supply)} sub={`${num(col.total_supply)} minted`} />
        <StatCard label="Holders" value={num(col.holders ?? 0)} />
        <StatCard label="Floor" value={col.floor ? num(col.floor, 2) : "—"} />
        <StatCard label="Volume (all)" value={col.volume_all ? num(col.volume_all, 2) : "—"} />
      </div>

      <Panel title="Items">
        <Table head={["#", "Token", "Name", "Owner"]}>
          {nfts.map((n) => (
            <tr key={n.token_id}>
              <td className="py-2 pr-4 tabular-nums">{n.serial}</td>
              <td className="py-2 pr-4 font-mono text-xs">{n.token_id.slice(0, 16)}…</td>
              <td className="py-2 pr-4">{n.name ?? "—"}</td>
              <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(n.owner)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
