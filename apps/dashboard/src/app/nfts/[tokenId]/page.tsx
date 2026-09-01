import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CopyAddr, CopyButton } from "@/components/CopyAddr";
import { Crumb, Panel, Table } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { int, shortAddr } from "@/lib/format";
import { NftMedia } from "./NftMedia";

export const dynamic = "force-dynamic";

interface Offer {
  offer_id: string;
  account: string | null;
  destination: string | null;
  is_sell: boolean;
  created_ledger_seq: number | null;
  label: string;
}
interface Sale {
  tx_hash: string;
  idx: number;
  ledger_seq: number | null;
  seller: string | null;
  buyer: string | null;
  label: string;
}
interface Trait {
  trait_type?: string;
  name?: string;
  value?: unknown;
}
interface NftDetail {
  tokenId: string;
  issuer: string;
  owner: string | null;
  collection: string | null;
  taxon: number;
  serial: number;
  flags: number;
  transferFee: number;
  mintLedgerSequence: number | null;
  burnLedgerSequence: number | null;
  uri: string | null;
  live: boolean;
  offers: Offer[];
  sales: Sale[];
  media: {
    imageUri: string | null;
    mediaUri: string | null;
    mediaType: string | null;
    image: string | null;
    animation: string | null;
  };
  meta: {
    name: string | null;
    description: string | null;
    attributes: Trait[] | null;
    collectionName: string | null;
    source: string | null;
  } | null;
}

const NFT_FLAGS: [number, string][] = [
  [0x1, "burnable"],
  [0x2, "onlyXRP"],
  [0x4, "trustLine"],
  [0x8, "transferable"],
  [0x10, "mutable"],
];

/** Link that actually opens: ipfs:// & ar:// via the same-origin proxy, else the direct URL. */
function openHref(canonical: string | null, resolved: string | null): string | null {
  if (canonical && /^(ipfs|ar):\/\//i.test(canonical)) return `/api/img?u=${encodeURIComponent(canonical)}`;
  return resolved ?? null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-panel-border py-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function UriRow({ label, value, open }: { label: string; value: string | null; open: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-panel-border py-2 last:border-0">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        {label}
        {open && (
          <a href={open} target="_blank" rel="noreferrer" className="text-viz-1 hover:underline">
            open ↗
          </a>
        )}
      </div>
      <div className="flex items-start gap-2">
        <span className="break-all font-mono text-xs">{value}</span>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export default async function NftDetailPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;

  let nft: NftDetail;
  try {
    nft = await api<NftDetail>(`/nfts/${encodeURIComponent(tokenId)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const title = nft.meta?.name ?? `NFT #${nft.serial}`;
  const collLabel = nft.meta?.collectionName ?? shortAddr(nft.issuer);
  const traits = nft.meta?.attributes ?? [];
  const activeFlags = NFT_FLAGS.filter(([bit]) => (nft.flags & bit) !== 0).map(([, name]) => name);

  return (
    <div className="space-y-6">
      <Crumb
        items={[
          { href: "/nfts/collections", label: "Collections" },
          { href: `/nfts/collections/${nft.issuer}/${nft.taxon}`, label: collLabel },
          { label: title },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs ${nft.live ? "bg-viz-2/20 text-viz-2" : "bg-viz-4/20 text-viz-4"}`}
        >
          {nft.live ? "live" : "burned"}
        </span>
        {nft.meta?.source && (
          <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted">{nft.meta.source}</span>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <NftMedia
          imageUri={nft.media.imageUri}
          mediaUri={nft.media.mediaUri}
          image={nft.media.image}
          animation={nft.media.animation}
          mediaType={nft.media.mediaType}
          name={title}
        />

        <dl className="rounded-xl border border-panel-border bg-panel px-5 py-1">
          <Fact label="Token ID">
            <CopyAddr addr={nft.tokenId} display={shortAddr(nft.tokenId)} />
          </Fact>
          <Fact label="Issuer">
            <CopyAddr addr={nft.issuer} href={`/issuers/${nft.issuer}`} />
          </Fact>
          <Fact label="Owner">
            <CopyAddr addr={nft.owner} />
          </Fact>
          <Fact label="Collection">
            <Link
              href={`/nfts/collections/${nft.issuer}/${nft.taxon}`}
              className="text-viz-1 hover:underline"
            >
              {nft.meta?.collectionName ?? `taxon ${nft.taxon}`}
            </Link>
          </Fact>
          <Fact label="Taxon">{nft.taxon}</Fact>
          <Fact label="Serial">{int(nft.serial)}</Fact>
          <Fact label="Transfer fee">{(nft.transferFee / 1000).toFixed(3)}%</Fact>
          <Fact label="Flags">
            {activeFlags.length ? (
              <span className="flex flex-wrap gap-1">
                {activeFlags.map((f) => (
                  <span key={f} className="rounded bg-white/5 px-1.5 py-0.5 text-xs">
                    {f}
                  </span>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Minted">{int(nft.mintLedgerSequence)}</Fact>
          {!nft.live && <Fact label="Burned">{int(nft.burnLedgerSequence)}</Fact>}
        </dl>
      </div>

      {nft.meta?.description && (
        <Panel title="Description">
          <p className="whitespace-pre-wrap text-sm text-muted">{nft.meta.description}</p>
        </Panel>
      )}

      {traits.length > 0 && (
        <Panel title="Attributes">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {traits.map((t, i) => (
              <div key={i} className="rounded-lg border border-panel-border bg-[#0b0e14] p-2">
                <div className="truncate text-xs uppercase tracking-wide text-muted">
                  {t.trait_type ?? t.name ?? "trait"}
                </div>
                <div className="truncate text-sm" title={String(t.value ?? "")}>
                  {String(t.value ?? "—")}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Canonical URIs">
        <UriRow label="On-chain URI" value={nft.uri} open={null} />
        <UriRow label="Image" value={nft.media.imageUri} open={openHref(nft.media.imageUri, nft.media.image)} />
        <UriRow
          label="Animation"
          value={nft.media.mediaUri}
          open={openHref(nft.media.mediaUri, nft.media.animation)}
        />
        {!nft.uri && !nft.media.imageUri && !nft.media.mediaUri && (
          <p className="py-2 text-sm text-muted">No URIs recorded.</p>
        )}
      </Panel>

      {nft.offers.length > 0 && (
        <Panel title={`Open offers (${nft.offers.length})`}>
          <Table head={["Type", "Amount", "From", "Destination", "Ledger"]}>
            {nft.offers.map((o) => (
              <tr key={o.offer_id}>
                <td className="py-2 pr-4">
                  <span className={o.is_sell ? "text-viz-4" : "text-viz-2"}>
                    {o.is_sell ? "sell" : "buy"}
                  </span>
                </td>
                <td className="py-2 pr-4 tabular-nums">{o.label}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(o.account)}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(o.destination)}</td>
                <td className="py-2 pr-4 tabular-nums">{int(o.created_ledger_seq)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {nft.sales.length > 0 && (
        <Panel title="Recent sales">
          <Table head={["Ledger", "Amount", "Seller", "Buyer"]}>
            {nft.sales.map((s) => (
              <tr key={`${s.tx_hash}:${s.idx}`}>
                <td className="py-2 pr-4 tabular-nums">{int(s.ledger_seq)}</td>
                <td className="py-2 pr-4 tabular-nums">{s.label}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(s.seller)}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted">{shortAddr(s.buyer)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}
