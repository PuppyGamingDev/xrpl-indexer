import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-panel-border bg-panel p-5">
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-viz-2"
      : tone === "warn"
        ? "text-viz-3"
        : tone === "bad"
          ? "text-viz-4"
          : "text-white";
  return (
    <div className="rounded-xl border border-panel-border bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {value.toLocaleString()} <span className="text-muted">/ {max.toLocaleString()}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-[#0b0e14]">
        <div className="h-full rounded bg-viz-1" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h) => (
              <th key={h} className="pb-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-panel-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Crumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-4 text-sm text-muted">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-white">
              {it.label}
            </Link>
          ) : (
            <span className="text-white">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
