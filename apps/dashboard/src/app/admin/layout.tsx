import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // The login page renders its own tree; middleware already lets it through.
  if (!session?.user) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-panel-border pb-3">
        <div className="flex gap-4 text-sm">
          <Link href="/admin/keys" className="hover:text-white">
            API Keys
          </Link>
          <Link href="/backfill" className="text-muted hover:text-white">
            Jobs
          </Link>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/admin/login" });
            }}
          >
            <button className="rounded border border-panel-border px-2 py-1 hover:text-white">Sign out</button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}
