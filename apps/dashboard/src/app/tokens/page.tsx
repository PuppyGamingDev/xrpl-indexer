import { Panel } from "@/components/ui";
import { api } from "@/lib/api";
import { readListState, toApiQuery } from "@/lib/list";
import type { ListResponse, TokenRow } from "@/lib/types";
import { TokensTable } from "./TokensTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = readListState(await searchParams, {
    defaultSort: "holders",
    extraKeys: ["type", "verified", "issuer"],
  });
  const query = toApiQuery(state, PAGE_SIZE, { verified: "verified", type: "type", issuer: "issuer" });
  const res = await api<ListResponse & { tokens: TokenRow[] }>(`/tokens?${query}`);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Tokens</h1>
        <span className="text-sm tabular-nums text-muted">{res.total.toLocaleString()} total</span>
      </div>
      <Panel>
        <TokensTable rows={res.tokens} total={res.total} state={state} pageSize={PAGE_SIZE} />
      </Panel>
    </div>
  );
}
