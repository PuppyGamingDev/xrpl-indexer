import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-xl border border-panel-border bg-panel p-8 text-center">
      <p className="text-lg font-medium">Not found</p>
      <p className="mt-1 text-sm text-muted">That resource isn’t indexed (yet).</p>
      <Link href="/" className="mt-4 inline-block text-sm text-viz-1 hover:underline">
        ← Back to overview
      </Link>
    </div>
  );
}
