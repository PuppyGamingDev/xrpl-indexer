import { RangeSelect } from "@/components/RangeSelect";
import { Sparkline, type TimeStyle } from "@/components/Sparkline";
import { Bar, Panel, StatCard } from "@/components/ui";
import { api, apiSafe } from "@/lib/api";
import { int, num, pct } from "@/lib/format";
import type { ServerStats, StatsHistoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Range {
  label: string;
  hours: number;
  fmt: TimeStyle;
}
const RANGES: Record<string, Range> = {
  hour: { label: "Last hour", hours: 1, fmt: "time" },
  day: { label: "Last 24 hours", hours: 24, fmt: "time" },
  week: { label: "Last week", hours: 168, fmt: "datetime" },
  month: { label: "Last month", hours: 720, fmt: "datetime" },
  year: { label: "Last year", hours: 8760, fmt: "date" },
};
const DEFAULT_RANGE = "day";
const RANGE_OPTIONS = Object.entries(RANGES).map(([value, r]) => ({ value, label: r.label }));

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const key = range && range in RANGES ? range : DEFAULT_RANGE;
  const r: Range = RANGES[key] ?? RANGES.day!;

  const [stats, history] = await Promise.all([
    api<ServerStats>("/stats", { revalidate: 5 }),
    apiSafe<StatsHistoryRow[]>(`/stats/history?hours=${r.hours}`, { revalidate: 30 }),
  ]);

  const lag = stats.ledger.lagSeconds;
  const lagTone = lag == null ? "warn" : lag < 30 ? "good" : lag < 300 ? "warn" : "bad";

  const hist = history ?? [];
  const series = (key: string) =>
    hist.map((r) => ({ x: new Date(r.ts).getTime(), y: Number(r.stats[key] ?? 0) }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Indexed ledger"
          value={int(stats.ledger.latestSequence)}
          sub={
            stats.ledger.firstSequence
              ? `from ${int(stats.ledger.firstSequence)}`
              : stats.ledger.closeTime
                ? new Date(stats.ledger.closeTime).toUTCString().slice(17, 25) + " UTC"
                : "—"
          }
        />
        <StatCard
          label="Sync lag"
          value={lag == null ? "—" : `${lag}s`}
          tone={lagTone}
          sub={lag == null ? "no ledgers yet" : lag < 30 ? "healthy" : "behind"}
        />
        <StatCard label="Accounts" value={num(stats.accounts)} />
        <StatCard
          label="Tokens"
          value={num(stats.tokens.total)}
          sub={`${num(stats.tokens.iou)} IOU · ${num(stats.tokens.mpt)} MPT`}
        />
        <StatCard
          label="NFTs"
          value={num(stats.nfts.total)}
          sub={`${num(stats.nfts.live)} live · ${num(stats.nfts.burned)} burned`}
        />
        <StatCard label="Collections" value={num(stats.collections.total)} />
        <StatCard
          label="Issuers"
          value={num(stats.issuers.token + stats.issuers.nft)}
          sub={`${num(stats.issuers.token)} token · ${num(stats.issuers.nft)} NFT`}
        />
        <StatCard
          label="DeFi objects"
          value={num(stats.defi.amm + stats.defi.vaults + stats.defi.oracles)}
          sub={`${num(stats.defi.amm)} AMM · ${num(stats.defi.vaults)} vault · ${num(stats.defi.oracles)} oracle`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Metadata coverage">
          <Bar label="Tokens with metadata" value={stats.coverage.tokensWithMeta} max={stats.tokens.total} />
          <Bar label="NFTs with metadata" value={stats.coverage.nftsWithMeta} max={stats.nfts.total} />
          <Bar label="NFTs with attributes" value={stats.coverage.nftsWithAttributes} max={stats.nfts.total} />
          <p className="mt-3 text-xs text-muted">
            {pct(stats.coverage.nftsWithMeta, stats.nfts.total)} of NFTs enriched ·{" "}
            {pct(stats.coverage.tokensWithMeta, stats.tokens.total)} of tokens
          </p>
        </Panel>

        <Panel
          title="Trend"
          action={<RangeSelect param="range" value={key} options={RANGE_OPTIONS} />}
        >
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs text-muted">Indexed ledger</div>
              <Sparkline data={series("latest_seq")} color="var(--color-viz-1)" label="Ledger" timeStyle={r.fmt} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted">NFTs enriched</div>
              <Sparkline
                data={series("nfts_with_meta")}
                color="var(--color-viz-2)"
                label="NFTs enriched"
                timeStyle={r.fmt}
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted">Tokens enriched</div>
              <Sparkline
                data={series("tokens_with_meta")}
                color="var(--color-viz-3)"
                label="Tokens enriched"
                timeStyle={r.fmt}
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
