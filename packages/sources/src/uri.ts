const CIDV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}/;
const CIDV1 = /^ba[a-z2-7]{57,}/;

export interface GatewayConfig {
  ipfsGateways: string[];
  arweaveGateway: string;
}

/**
 * Rewrite any IPFS/Arweave reference to its canonical scheme so the stored
 * value is gateway-independent. Everything else (`https://`, `data:`) passes
 * through untouched.
 */
export function canonicalizeUri(raw: string): string {
  const uri = raw.trim();
  if (!uri) return uri;

  if (uri.startsWith("ipfs://")) {
    let rest = uri.slice("ipfs://".length);
    if (rest.startsWith("ipfs/")) rest = rest.slice(5);
    return `ipfs://${stripLeadingSlash(rest)}`;
  }
  if (uri.startsWith("ar://")) {
    return `ar://${stripLeadingSlash(uri.slice("ar://".length))}`;
  }

  if (/^https?:\/\//i.test(uri)) {
    try {
      const u = new URL(uri);
      const ipfsIdx = u.pathname.indexOf("/ipfs/");
      if (ipfsIdx !== -1) {
        return `ipfs://${stripLeadingSlash(u.pathname.slice(ipfsIdx + 6))}${u.search}`;
      }
      if (/(^|\.)arweave\.net$/i.test(u.hostname) && u.pathname.length > 1) {
        return `ar://${stripLeadingSlash(u.pathname)}`;
      }
      // subdomain gateway: <cid>.ipfs.<host> — the label is a CID by construction
      const sub = u.hostname.match(/^([a-z0-9]+)\.ipfs\./i);
      if (sub) {
        const path = u.pathname === "/" ? "" : u.pathname;
        return `ipfs://${sub[1]}${path}${u.search}`;
      }
      return uri;
    } catch {
      return uri;
    }
  }

  if (CIDV0.test(uri) || CIDV1.test(uri)) return `ipfs://${uri}`;
  return uri;
}

/** Ordered list of concrete http(s) URLs to try, rotating the gateway per call. */
export function resolveForFetch(uri: string, gw: GatewayConfig, rotation = 0): string[] {
  const canon = canonicalizeUri(uri);

  if (canon.startsWith("ipfs://")) {
    const path = canon.slice("ipfs://".length);
    const gws = rotate(gw.ipfsGateways, rotation);
    return gws.map((g) => `${trimSlash(g)}/ipfs/${path}`);
  }
  if (canon.startsWith("ar://")) {
    return [`${trimSlash(gw.arweaveGateway)}/${canon.slice("ar://".length)}`];
  }
  if (canon.startsWith("data:")) return [canon];
  if (/^https?:\/\//i.test(canon)) return [canon];
  return [];
}

/** Parse a `data:` URI that carries JSON (base64 or percent-encoded). */
export function parseDataUriJson(uri: string): unknown | null {
  const m = uri.match(/^data:([^,]*),(.*)$/s);
  if (!m) return null;
  const meta = m[1] ?? "";
  const payload = m[2] ?? "";
  try {
    const text = meta.includes("base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length <= 1) return [...arr];
  const k = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}
const stripLeadingSlash = (s: string) => s.replace(/^\/+/, "");
const trimSlash = (s: string) => s.replace(/\/+$/, "");
