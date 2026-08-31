import "server-only";

const BASE = process.env.XRPL_API_BASE_URL ?? "http://localhost:4100";
const KEY = process.env.XRPL_API_KEY ?? "";
const ADMIN_KEY = process.env.XRPL_API_ADMIN_KEY ?? KEY;

export interface ApiOptions {
  admin?: boolean;
  /** Next.js fetch revalidation seconds. */
  revalidate?: number;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

/**
 * Server-only fetch to apps/api. The API key lives here and never crosses to
 * the browser — every caller is a Server Component or a Route Handler.
 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-api-key": opts.admin ? ADMIN_KEY : KEY,
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    next: { revalidate: opts.revalidate ?? 10 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Best-effort GET that returns null instead of throwing — for optional panels. */
export async function apiSafe<T>(path: string, opts?: ApiOptions): Promise<T | null> {
  try {
    return await api<T>(path, opts);
  } catch {
    return null;
  }
}
