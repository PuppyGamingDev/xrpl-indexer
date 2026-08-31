import { throttle } from "../ratelimit.ts";
import { safeFetch } from "../safe-fetch.ts";
import { canonicalizeUri } from "../uri.ts";
import type { ProviderIssuer, ProviderToken, TokenInfoProvider } from "./types.ts";

export interface XrplMetaOptions {
  baseUrl?: string;
  requestsPerMinute?: number;
}

interface XrplMetaResponse {
  meta?: {
    token?: {
      name?: string;
      description?: string;
      desc?: string;
      icon?: string;
      trust_level?: number;
      urls?: { url: string; type?: string }[];
      weblinks?: { url: string; type?: string }[];
    };
    issuer?: {
      name?: string;
      domain?: string;
      icon?: string;
      twitter?: string;
      description?: string;
      kyc?: boolean;
      trusted?: boolean;
    };
  };
}

/** xrplmeta.org public token metadata API (cross-check / fallback source). */
export class XrplMetaProvider implements TokenInfoProvider {
  readonly name = "xrplmeta";
  private readonly baseUrl: string;
  private readonly rpm: number;

  constructor(opts: XrplMetaOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://s1.xrplmeta.org").replace(/\/+$/, "");
    this.rpm = opts.requestsPerMinute ?? 240;
  }

  async fetchToken(currency: string, issuer: string): Promise<ProviderToken | null> {
    const r = await this.get(`${currency}:${issuer}`);
    const tk = r?.meta?.token;
    if (!tk) return null;
    return {
      currency,
      issuer,
      name: tk.name ?? r?.meta?.issuer?.name ?? null,
      description: tk.description ?? tk.desc ?? r?.meta?.issuer?.description ?? null,
      iconUri: tk.icon ? canonicalizeUri(tk.icon) : (r?.meta?.issuer?.icon ? canonicalizeUri(r.meta.issuer.icon) : null),
      domain: r?.meta?.issuer?.domain ?? null,
      trustLevel: tk.trust_level ?? (r?.meta?.issuer?.kyc || r?.meta?.issuer?.trusted ? 2 : 0),
      links: linksFrom(tk.urls ?? tk.weblinks),
      raw: r,
    };
  }

  async fetchIssuer(address: string): Promise<ProviderIssuer | null> {
    // xrplmeta keys issuer data under a token; caller usually has one. Without a
    // currency we can't query, so this stays null unless extended.
    void address;
    return null;
  }

  private async get(pair: string): Promise<XrplMetaResponse | null> {
    await throttle("xrplmeta", this.rpm);
    try {
      const res = await safeFetch<XrplMetaResponse>(
        `${this.baseUrl}/token/${encodeURIComponent(pair)}`,
        { as: "json" },
      );
      if (res.status < 200 || res.status >= 300) return null;
      return res.data;
    } catch {
      return null;
    }
  }
}

function linksFrom(weblinks?: { url: string; type?: string }[]): Record<string, string> | null {
  if (!weblinks?.length) return null;
  const out: Record<string, string> = {};
  for (const w of weblinks) if (w.url) out[w.type ?? "website"] = w.url;
  return Object.keys(out).length ? out : null;
}
