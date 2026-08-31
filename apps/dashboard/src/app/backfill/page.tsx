import { Bar, Panel, StatCard, Table } from "@/components/ui";
import { api, apiSafe } from "@/lib/api";
import { num } from "@/lib/format";
import type { QueueDepths, ServerStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BackfillPage() {
  const [stats, jobs] = await Promise.all([
    api<ServerStats>("/stats"),
    apiSafe<QueueDepths>("/admin/jobs", { admin: true }),
  ]);

  const queues = jobs?.queues ?? {};
  const totalQueued = Object.values(queues).reduce((a, q) => a + q.queued, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Backfill</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Jobs queued" value={num(totalQueued)} tone={totalQueued > 5000 ? "warn" : "default"} />
        <StatCard
          label="NFT coverage"
          value={num(stats.coverage.nftsWithMeta)}
          sub={`of ${num(stats.nfts.total)}`}
        />
        <StatCard
          label="Token coverage"
          value={num(stats.coverage.tokensWithMeta)}
          sub={`of ${num(stats.tokens.total)}`}
        />
        <StatCard label="NFTs w/ attributes" value={num(stats.coverage.nftsWithAttributes)} />
      </div>

      <Panel title="Queue depth">
        {jobs ? (
          <Table head={["Queue", "Queued"]}>
            {Object.entries(queues).map(([name, q]) => (
              <tr key={name}>
                <td className="py-2 pr-4 font-mono text-xs">{name}</td>
                <td className="py-2 pr-4 tabular-nums">{num(q.queued)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-muted">Job stats unavailable (is the API reachable with an admin key?).</p>
        )}
      </Panel>

      <Panel title="Enrichment funnel">
        <Bar label="NFTs with on-chain URI" value={stats.nfts.withUri} max={stats.nfts.total} />
        <Bar label="NFTs enriched" value={stats.coverage.nftsWithMeta} max={stats.nfts.total} />
        <Bar label="NFTs with attributes" value={stats.coverage.nftsWithAttributes} max={stats.nfts.total} />
        <Bar label="Tokens enriched" value={stats.coverage.tokensWithMeta} max={stats.tokens.total} />
      </Panel>
    </div>
  );
}
