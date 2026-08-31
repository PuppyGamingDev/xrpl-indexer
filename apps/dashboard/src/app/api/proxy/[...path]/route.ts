import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";

/**
 * Authenticated read-only passthrough for client components. The API key is
 * attached server-side here and never reaches the browser. Only whitelisted
 * path prefixes are forwarded.
 */
const ALLOW = [/^stats/, /^tokens/, /^mpts/, /^nfts/, /^collections/, /^amm$/, /^vaults$/, /^oracles$/, /^accounts\//];

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join("/");
  if (!ALLOW.some((re) => re.test(joined))) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }
  const search = new URL(req.url).search;
  try {
    const data = await api(`/${joined}${search}`, { revalidate: 5 });
    return NextResponse.json(data);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
