import { KeyManager, type ApiKey } from "@/components/KeyManager";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const { keys } = await api<{ keys: ApiKey[] }>("/admin/keys", { admin: true, revalidate: 0 });
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">API Keys</h1>
      <KeyManager initialKeys={keys} />
    </div>
  );
}
