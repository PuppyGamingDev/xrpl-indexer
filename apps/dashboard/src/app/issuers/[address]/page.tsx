import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddr } from "@/components/CopyAddr";
import { Crumb, Panel, StatCard, Table } from "@/components/ui";
import { api, apiSafe, ApiError } from "@/lib/api";
import { num, shortAddr } from "@/lib/format";
import type { CollectionRow, ListResponse, TokenRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const PREVIEW = 50;

interface IssuerInfo {
  address: string;
  blackholed: boolean;
  pseudo: boolean;
  pseudoSource: string | null;
  meta: {
    name: string | null;
    description: string | null;
    iconUri: string | null;
    twitter: string | null;
    domain: string | null;
    verified: boolean;
  } | null;
  tokensTotal: number;
  collectionsTotal: number;
  nftsTotal: number;
}

export default async function IssuerPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  let info: IssuerInfo;
  try {
    info = await api<IssuerInfo>(`/issuers/${encodeURIComponent(address)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const [tokens, collections] = await Promise.all([
    apiSafe<ListResponse & { tokens: TokenRow[] }>(
      `/tokens?issuer=${encodeURIComponent(address)}&sortBy=holders&order=desc&limit=${PREVIEW}`,
    ),
    apiSafe<ListResponse & { collections: CollectionRow[] }>(
      `/collections?issuer=${encodeURIComponent(address)}&sortBy=supply&order=desc&limit=${PREVIEW}`,
    ),
  ]);

  const title = info.meta?.name ?? shortAddr(address);
  const twitterHandle = info.meta?.twitter?.replace(/^@/, "");

  return (
    <div className="space-y-6">
      <Crumb items={[{ label: title }]} />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {info.meta?.verified && (
          <span className="rounded bg-viz-2/20 px-2 py-0.5 text-xs text-viz-2">verified</span>
        )}
        {info.blackholed && (
          <span className="rounded bg-viz-3/20 px-2 py-0.5 text-xs text-viz-3">blackholed</span>
        )}
        {info.pseudo && (
          <span className="rounded bg-viz-5/20 px-2 py-0.5 text-xs text-viz-5">
            {info.pseudoSource ?? "pool"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <CopyAddr addr={info.address} />
        {info.meta?.domain && (
          <a
            href={`https://${info.meta.domain.replace(/^https?:\/\//, "")}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white hover:underline"
          >
            {info.meta.domain}
          </a>
        )}
        {twitterHandle && (
          <a
            href={`https://x.com/${twitterHandle}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white hover:underline"
          >
            @{twitterHandle}
          </a>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Tokens" value={num(info.tokensTotal)} />
        <StatCard label="Collections" value={num(info.collectionsTotal)} />
        <StatCard label="NFTs minted" value={num(info.nftsTotal)} />
      </div>

      <Panel
        title="Tokens issued"
        action={
          (tokens?.total ?? 0) > PREVIEW ? (
            <Link href={`/tokens?issuer=${address}`} className="text-xs text-viz-1 hover:underline">
              See all {num(tokens?.total ?? 0)} ›
            </Link>
          ) : undefined
        }
      >
        <Table head={["Token", "Type", "Holders", "Supply", "Vol 24h"]}>
          {(tokens?.tokens ?? []).map((t) => {
            const label = t.name ?? t.currency ?? t.mpt_issuance_id?.slice(0, 12) ?? "—";
            const href =
              t.token_type === "MPT"
                ? `/tokens/mpt:${t.mpt_issuance_id}`
                : `/tokens/${t.issuer}:${t.currency}`;
            return (
              <tr key={t.id}>
                <td className="py-2 pr-4">
                  <Link href={href} className="text-viz-1 hover:underline">
                    {label}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-xs text-muted">{t.token_type}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.holders)}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.supply, 2)}</td>
                <td className="py-2 pr-4 tabular-nums">{num(t.volume_24h, 2)}</td>
              </tr>
            );
          })}
          {(tokens?.tokens ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted">
                No tokens issued
              </td>
            </tr>
          )}
        </Table>
      </Panel>

      <Panel
        title="Collections"
        action={
          (collections?.total ?? 0) > PREVIEW ? (
            <Link
              href={`/nfts/collections?issuer=${address}`}
              className="text-xs text-viz-1 hover:underline"
            >
              See all {num(collections?.total ?? 0)} ›
            </Link>
          ) : undefined
        }
      >
        <Table head={["Collection", "Supply", "Holders", "Vol all"]}>
          {(collections?.collections ?? []).map((c) => (
            <tr key={c.id}>
              <td className="py-2 pr-4">
                <Link
                  href={`/nfts/collections/${c.issuer}/${c.taxon}`}
                  className="text-viz-1 hover:underline"
                >
                  {c.name ?? `Collection ${c.id}`}
                </Link>
              </td>
              <td className="py-2 pr-4 tabular-nums">{num(c.live_supply || c.supply)}</td>
              <td className="py-2 pr-4 tabular-nums">{num(c.holders)}</td>
              <td className="py-2 pr-4 tabular-nums">{num(c.volume_all, 2)}</td>
            </tr>
          ))}
          {(collections?.collections ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-muted">
                No collections
              </td>
            </tr>
          )}
        </Table>
      </Panel>
    </div>
  );
}
