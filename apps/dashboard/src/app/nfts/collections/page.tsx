import { Panel } from "@/components/ui";
import { api } from "@/lib/api";
import { readListState, toApiQuery } from "@/lib/list";
import type { CollectionRow, ListResponse } from "@/lib/types";
import { CollectionsTable } from "./CollectionsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = readListState(await searchParams, {
    defaultSort: "supply",
    extraKeys: ["named"],
  });
  const query = toApiQuery(state, PAGE_SIZE, { named: "namedOnly" });
  const res = await api<ListResponse & { collections: CollectionRow[] }>(`/collections?${query}`);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">NFT Collections</h1>
        <span className="text-sm tabular-nums text-muted">{res.total.toLocaleString()} total</span>
      </div>
      <Panel>
        <CollectionsTable rows={res.collections} total={res.total} state={state} pageSize={PAGE_SIZE} />
      </Panel>
    </div>
  );
}
