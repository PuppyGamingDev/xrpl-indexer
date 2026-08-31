import Link from "next/link";
import { Panel, Table } from "@/components/ui";
import { api } from "@/lib/api";
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
  volume_24h: string | null;
  live_supply: number;
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sortBy?: string }>;
}) {
  const { sortBy = "supply" } = await searchParams;
  const { collections } = await api<{ collections: Col[] }>(`/collections?limit=100&sortBy=${sortBy}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">NFT Collections</h1>
        <div className="flex gap-2 text-sm">
          {["supply", "holders", "trades"].map((s) => (
            <Link
              key={s}
              href={`/nfts/collections?sortBy=${s}`}
              className={`rounded px-2 py-1 ${s === sortBy ? "bg-viz-1 text-black" : "text-muted hover:text-white"}`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>
      <Panel>
        <Table head={["Collection", "Issuer", "Taxon", "Live supply", "Holders", "Floor", "Vol 24h"]}>
          {collections.map((c) => (
            <tr key={c.id} className="hover:bg-white/5">
              <td className="py-2 pr-4">
                <Link href={`/nfts/collections/${c.issuer}/${c.taxon}`} className="text-viz-1 hover:underline">
                  {c.name ?? `Collection ${c.id}`}
                </Link>
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(c.issuer)}</td>
              <td className="py-2 pr-4 tabular-nums">{c.taxon}</td>
              <td className="py-2 pr-4 tabular-nums">{num(c.live_supply)}</td>
              <td className="py-2 pr-4 tabular-nums">{num(c.holders ?? 0)}</td>
              <td className="py-2 pr-4 tabular-nums">{c.floor ? num(c.floor, 2) : "—"}</td>
              <td className="py-2 pr-4 tabular-nums">{c.volume_24h ? num(c.volume_24h, 2) : "—"}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
