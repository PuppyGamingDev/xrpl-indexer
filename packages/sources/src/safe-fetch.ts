import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { UpstreamError } from "@xrpl-indexer/core/errors";
import { isBlockedIp } from "./ip.ts";

export interface SafeFetchOptions {
  /** Hard ceiling on the response body. Default 5 MiB. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Max redirect hops to follow manually (each re-validated). Default 5. */
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** "json" parses + returns the object; "text" returns the string; "buffer" raw. */
  as?: "json" | "text" | "buffer";
}

export interface SafeFetchResult<T> {
  status: number;
  url: string;
  data: T;
}

const DEFAULTS = { maxBytes: 5 * 1024 * 1024, timeoutMs: 12_000, maxRedirects: 5 } as const;
const UA = "xrpl-indexer-metadata/0.1 (+https://github.com)";

/**
 * Fetch an attacker-controlled URL with SSRF protection: only http(s), only
 * public IPs (re-resolved and re-checked on every redirect hop), a body-size
 * ceiling, and a timeout.
 */
export async function safeFetch<T = unknown>(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult<T>> {
  const cfg = { ...DEFAULTS, ...opts };
  let url = rawUrl;

  for (let hop = 0; hop <= cfg.maxRedirects; hop++) {
    const parsed = assertPublicHttpUrl(url);
    await assertResolvesPublic(parsed.hostname);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(parsed, {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: { "user-agent": UA, accept: "*/*", ...cfg.headers },
      });
    } catch (err) {
      clearTimeout(timer);
      throw new UpstreamError(`fetch failed for ${parsed.origin}${parsed.pathname}`, err);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      url = new URL(res.headers.get("location")!, parsed).toString();
      continue;
    }

    const body = await readCapped(res, cfg.maxBytes);
    const data = decodeBody<T>(body, res.headers.get("content-type"), cfg.as);
    return { status: res.status, url: parsed.toString(), data };
  }
  throw new UpstreamError(`too many redirects for ${rawUrl}`);
}

function assertPublicHttpUrl(u: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new UpstreamError(`invalid URL: ${u}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UpstreamError(`blocked scheme: ${parsed.protocol}`);
  }
  // Only reject here when the host is an IP literal; hostnames are checked after DNS.
  const stripped = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(stripped) && isBlockedIp(stripped)) {
    throw new UpstreamError(`blocked host: ${parsed.hostname}`);
  }
  return parsed;
}

async function assertResolvesPublic(hostname: string): Promise<void> {
  const stripped = hostname.replace(/^\[|\]$/g, "");
  if (isIP(stripped)) {
    if (isBlockedIp(stripped)) throw new UpstreamError(`blocked host: ${hostname}`);
    return; // public IP literal — nothing to resolve
  }
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new UpstreamError(`DNS resolution failed for ${hostname}`);
  }
  for (const r of records) {
    if (isBlockedIp(r.address)) throw new UpstreamError(`${hostname} resolves to blocked ${r.address}`);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new UpstreamError(`response too large (${declared} bytes)`);
  if (!res.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new UpstreamError(`response exceeded ${maxBytes} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decodeBody<T>(buf: Buffer, contentType: string | null, as: SafeFetchOptions["as"]): T {
  if (as === "buffer") return buf as unknown as T;
  const text = buf.toString("utf8");
  if (as === "text") return text as unknown as T;
  // default: json, but tolerate missing/incorrect content-type
  try {
    return JSON.parse(text) as T;
  } catch {
    if (as === "json") throw new UpstreamError("expected JSON but body did not parse");
    return text as unknown as T;
  }
}
