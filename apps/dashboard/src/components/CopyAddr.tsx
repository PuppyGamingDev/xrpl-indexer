"use client";

import Link from "next/link";
import { useState } from "react";
import { shortAddr } from "@/lib/format";

/** Bare copy-to-clipboard glyph button. Flips ⧉ → ✓ for ~1.2s. */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={done ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={
        className ??
        "shrink-0 text-xs " +
          (done ? "text-viz-2" : "text-muted opacity-60 transition-opacity hover:opacity-100")
      }
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

/**
 * Truncated address with a copy button. When `href` is given the label becomes a
 * link; `display` overrides the truncated text (the full `addr` is still copied).
 */
export function CopyAddr({
  addr,
  display,
  href,
}: {
  addr: string | null | undefined;
  display?: string;
  href?: string;
}) {
  if (!addr) return <span className="text-muted">—</span>;
  const text = display ?? shortAddr(addr);

  return (
    <span className="group inline-flex items-center gap-1 font-mono text-xs">
      {href ? (
        <Link href={href} className="text-muted hover:text-white hover:underline">
          {text}
        </Link>
      ) : (
        <span className="text-muted">{text}</span>
      )}
      <CopyButton value={addr} />
    </span>
  );
}
