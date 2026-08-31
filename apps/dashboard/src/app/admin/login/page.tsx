"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      username: form.get("username"),
      password: form.get("password"),
      redirect: false,
    });
    setBusy(false);
    if (res?.error) {
      setError("Invalid username or password");
      return;
    }
    router.push(params.get("callbackUrl") ?? "/admin/keys");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-panel-border bg-panel p-6">
      <h1 className="mb-1 text-lg font-semibold">Operator sign-in</h1>
      <p className="mb-5 text-xs text-muted">Key management is restricted to dashboard operators.</p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          name="username"
          placeholder="username"
          autoComplete="username"
          className="w-full rounded border border-panel-border bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-viz-1"
        />
        <input
          name="password"
          type="password"
          placeholder="password"
          autoComplete="current-password"
          className="w-full rounded border border-panel-border bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-viz-1"
        />
        {error && <p className="text-sm text-viz-4">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded bg-viz-1 px-3 py-2 text-sm font-medium text-black disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
