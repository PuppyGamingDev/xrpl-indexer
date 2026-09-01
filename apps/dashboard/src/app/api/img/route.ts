import { NextResponse } from "next/server";

/**
 * Same-origin passthrough for NFT media. The browser can't hotlink public IPFS
 * gateways (CORP / referrer blocking), so it points <img>/<video> at this route
 * instead: we resolve an `ipfs://` / `ar://` URI to a gateway, stream the bytes
 * straight back, and store NOTHING — the canonical URI stays the only persisted
 * reference. Only `ipfs://` and `ar://` inputs are accepted, so this can never be
 * used as an open proxy for arbitrary hosts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IPFS_GATEWAY = (process.env.IPFS_GATEWAY ?? "https://w3s.link").replace(/\/+$/, "");
const AR_GATEWAY = (process.env.AR_GATEWAY ?? "https://arweave.net").replace(/\/+$/, "");
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const OK_TYPE = /^(image\/|video\/|audio\/|model\/|application\/octet-stream)/i;

function resolve(uri: string): string | null {
  if (uri.startsWith("ipfs://")) {
    let rest = uri.slice(7).replace(/^ipfs\//, "");
    if (!rest) return null;
    return `${IPFS_GATEWAY}/ipfs/${rest}`;
  }
  if (uri.startsWith("ar://")) {
    const rest = uri.slice(5);
    return rest ? `${AR_GATEWAY}/${rest}` : null;
  }
  return null;
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return NextResponse.json({ error: "missing ?u" }, { status: 400 });

  const target = resolve(u);
  if (!target) {
    return NextResponse.json({ error: "only ipfs:// and ar:// URIs are proxied" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // no Referer is sent on a server-side fetch, which is what gets browsers
      // blocked on dweb.link etc.
      headers: { accept: "image/*,video/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `fetch failed: ${(e as Error).message}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `gateway ${upstream.status}` }, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!OK_TYPE.test(type)) {
    return NextResponse.json({ error: `unexpected content-type: ${type}` }, { status: 415 });
  }

  const len = Number(upstream.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) {
    return NextResponse.json({ error: "media too large" }, { status: 413 });
  }

  // Hard byte cap even when the gateway omits content-length.
  let seen = 0;
  const capped = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) {
          ctrl.error(new Error("media too large"));
          return;
        }
        ctrl.enqueue(chunk);
      },
    }),
  );

  const headers = new Headers({
    "content-type": type,
    // CID / arweave-tx content is immutable — cache hard at the browser + any CDN.
    "cache-control": "public, max-age=86400, s-maxage=31536000, immutable",
  });
  if (len) headers.set("content-length", String(len));

  return new Response(capped, { status: 200, headers });
}
