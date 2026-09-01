"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { nextSearch, type ListState } from "@/lib/list";

export type SetParam = (patch: Record<string, string | number | boolean | null>) => void;

export interface Column<T> {
  /** API sort key. Empty string = column is not sortable. */
  key: string;
  header: string;
  align?: "right";
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  total: number;
  state: ListState;
  pageSize: number;
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  /** Page-specific filter controls; called with the param setter. */
  toolbar?: (setParam: SetParam) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  total,
  state,
  pageSize,
  rowKey,
  searchPlaceholder,
  toolbar,
}: Props<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam: SetParam = (patch) => {
    startTransition(() => {
      router.replace(pathname + nextSearch(sp, patch), { scroll: false });
    });
  };

  // Debounced search — local input state, pushed to the URL after a pause.
  const [term, setTerm] = useState(state.q);
  useEffect(() => setTerm(state.q), [state.q]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      if (term !== state.q) setParam({ q: term || null });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const onSort = (key: string) => {
    if (!key) return;
    const dir =
      state.sort === key ? (state.dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
    setParam({ sort: key, dir });
  };

  const offset = (state.page - 1) * pageSize;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={searchPlaceholder ?? "Search"}
          className="w-64 rounded border border-panel-border bg-[#0b0e14] px-3 py-1.5 text-sm outline-none focus:border-viz-1"
        />
        {toolbar?.(setParam)}
        <div className="ml-auto text-xs tabular-nums text-muted">
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </div>
      </div>

      <div className={`overflow-x-auto ${pending ? "pointer-events-none opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              {columns.map((c) => (
                <th
                  key={c.header}
                  className={`pb-2 pr-4 font-medium ${c.align === "right" ? "text-right" : ""}`}
                >
                  {c.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      {c.header}
                      <span className="w-2 text-viz-1">
                        {state.sort === c.key ? (state.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-panel-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-muted">
                  No results
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={rowKey(r)} className="hover:bg-white/5">
                  {columns.map((c) => (
                    <td
                      key={c.header}
                      className={`py-2 pr-4 ${c.align === "right" ? "tabular-nums text-right" : ""}`}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">
          Page {state.page.toLocaleString()} of {lastPage.toLocaleString()}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={state.page <= 1}
            onClick={() => setParam({ page: state.page - 1 })}
            className="rounded border border-panel-border px-3 py-1 hover:border-viz-1 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <button
            type="button"
            disabled={state.page >= lastPage}
            onClick={() => setParam({ page: state.page + 1 })}
            className="rounded border border-panel-border px-3 py-1 hover:border-viz-1 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
