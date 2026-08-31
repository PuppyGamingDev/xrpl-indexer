"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, Table } from "@/components/ui";

export interface ApiKey {
  id: string;
  label: string;
  key_prefix: string;
  scopes: string[];
  rate_limit: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const SCOPES = ["nfts", "tokens", "amm", "vaults", "oracles", "stats", "admin"];

export function KeyManager({ initialKeys }: { initialKeys: ApiKey[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(["nfts", "tokens"]);
  const [rate, setRate] = useState(120);
  const [created, setCreated] = useState<{ key: string; keyPrefix: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, scopes, rateLimit: rate }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCreated(await res.json());
      setLabel("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Clients using it will get 401 immediately.")) return;
    await fetch(`/api/admin/keys/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Panel title="Create key">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (e.g. mobile-app)"
            className="rounded border border-panel-border bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-viz-1"
          />
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-28 rounded border border-panel-border bg-[#0b0e14] px-3 py-2 text-sm"
            title="requests / 60s"
          />
          <button
            onClick={create}
            disabled={busy || !label}
            className="rounded bg-viz-1 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))
                }
              />
              {s}
            </label>
          ))}
        </div>
        {err && <p className="mt-3 text-sm text-viz-4">{err}</p>}
        {created && (
          <div className="mt-4 rounded border border-viz-2/40 bg-viz-2/10 p-3">
            <p className="text-xs text-viz-2">Copy this key now — it is shown only once.</p>
            <code className="mt-1 block break-all rounded bg-[#0b0e14] p-2 text-sm">{created.key}</code>
          </div>
        )}
      </Panel>

      <Panel title="Keys">
        <Table head={["Label", "Prefix", "Scopes", "Rate", "Last used", "Status", ""]}>
          {initialKeys.map((k) => (
            <tr key={k.id}>
              <td className="py-2 pr-4">{k.label}</td>
              <td className="py-2 pr-4 font-mono text-xs">{k.key_prefix}…</td>
              <td className="py-2 pr-4 text-xs text-muted">{k.scopes.join(", ")}</td>
              <td className="py-2 pr-4 tabular-nums">{k.rate_limit}</td>
              <td className="py-2 pr-4 text-xs text-muted">
                {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
              </td>
              <td className="py-2 pr-4">
                {k.revoked_at ? (
                  <span className="text-xs text-viz-4">revoked</span>
                ) : (
                  <span className="text-xs text-viz-2">active</span>
                )}
              </td>
              <td className="py-2">
                {!k.revoked_at && (
                  <button onClick={() => revoke(k.id)} className="text-xs text-viz-4 hover:underline">
                    revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
