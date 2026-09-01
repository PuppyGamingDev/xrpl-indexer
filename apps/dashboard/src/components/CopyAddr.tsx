"use client";

import { useState } from "react";
import { shortAddr } from "@/lib/format";

/** Truncated address that copies the full value on click. */
export function CopyAddr({ addr }: { addr: string | null | undefined }) {
  const [done, setDone] = useState(false);
  if (!addr) return <span className="text-muted">—</span>;

  return (
    <button
      type="button"
      title={done ? "Copied" : addr}
      onClick={() => {
        void navigator.clipboard?.writeText(addr);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="group inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-white"
    >
      {shortAddr(addr)}
      <span className={done ? "text-viz-2" : "opacity-0 transition-opacity group-hover:opacity-60"}>
        {done ? "✓" : "⧉"}
      </span>
    </button>
  );
}
