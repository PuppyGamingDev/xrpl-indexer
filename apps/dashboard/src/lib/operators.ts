import "server-only";

const BASE = process.env.XRPL_API_BASE_URL ?? "http://localhost:4100";
const ADMIN_KEY = process.env.XRPL_API_ADMIN_KEY ?? process.env.XRPL_API_KEY ?? "";

export interface Operator {
  id: number;
  username: string;
}

/**
 * Verify a dashboard operator via the API's `/admin/login` endpoint. The
 * dashboard needs no direct database access — only `XRPL_API_BASE_URL` and the
 * admin-scoped key. Safe for a Vercel deployment.
 */
export async function verifyOperator(username: string, password: string): Promise<Operator | null> {
  if (!username || !password) return null;
  try {
    const res = await fetch(`${BASE}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ADMIN_KEY },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { operator?: Operator };
    return data.operator ?? null;
  } catch {
    return null;
  }
}
