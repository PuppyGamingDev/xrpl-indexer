"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function RangeSelect({
  param,
  value,
  options,
}: {
  param: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        p.set(param, e.target.value);
        start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
      }}
      className="rounded border border-panel-border bg-[#0b0e14] px-2 py-1 text-xs outline-none focus:border-viz-1 disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
