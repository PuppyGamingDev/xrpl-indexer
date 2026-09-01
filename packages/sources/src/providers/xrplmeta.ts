import { createLogger } from "@xrpl-indexer/core/logger";
import { throttle } from "../ratelimit.ts";
import { safeFetch } from "../safe-fetch.ts";
import { canonicalizeUri } from "../uri.ts";
import type {
  ProviderIssuer,
  ProviderToken,
  TokenCatalogProvider,
  TokenInfoProvider,
} from "./types.ts";

const log = createLogger("sources.xrplmeta");

export interface XrplMetaOptions {
  baseUrl?: string;
  requestsPerMinute?: number;
}

interface XrplMetaTokenMeta {
  name?: string;
  description?: string;
  desc?: string;
  icon?: string;
  trust_level?: number;
  urls?: { url: string; type?: string }[];
  weblinks?: { url: string; type?: string }[];
}

interface XrplMetaIssuerMeta {
  name?: string;
  domain?: string;
  icon?: string;
  twitter?: string;
  description?: string;
  kyc?: boolean;
  trusted?: boolean;
}

interface XrplMetaResponse {
  meta?: { token?: XrplMetaTokenMeta; issuer?: XrplMetaIssuerMeta };
}

interface XrplMetaListItem {
  currency?: string;
  issuer?: string;
  meta?: { token?: XrplMetaTokenMeta; issuer?: XrplMetaIssuerMeta };
}

interface XrplMetaListResponse {
  count?: number;
  tokens?: XrplMetaListItem[];
}

const LIST_PAGE = 100;

/** xrplmeta.org public token metadata API (cross-check / bulk source). */
export class XrplMetaProvider implements TokenInfoProvider, TokenCatalogProvider {
  readonly name = "xrplmeta";
  private readonly baseUrl: string;
  private readonly rpm: number;

  constructor(opts: XrplMetaOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://s1.xrplmeta.org").replace(/\/+$/, "");
    this.rpm = opts.requestsPerMinute ?? 240;
  }

  async fetchToken(currency: string, issuer: string): Promise<ProviderToken | null> {
    const r = await this.getJson<XrplMetaResponse>(
      `/token/${encodeURIComponent(`${currency}:${issuer}`)}`,
    );
    const tk = r?.meta?.token;
    if (!tk) return null;
    return toProviderToken(currency, issuer, r.meta ?? {});
  }

  async fetchIssuer(address: string): Promise<ProviderIssuer | null> {
    // xrplmeta keys issuer data under a token; without a currency we can't query.
    void address;
    return null;
  }

  /** Paginate the entire token list (IOU + MPT) with metadata expanded. */
  async *fetchAllTokens(): AsyncGenerator<{ token: ProviderToken; issuer: ProviderIssuer | null }> {
    let offset = 0;
    let count = Infinity;
    while (offset < count) {
      const page = await this.getJson<XrplMetaListResponse>(
        `/tokens?limit=${LIST_PAGE}&offset=${offset}&expand_meta`,
      );
      const list = page?.tokens ?? [];
      if (page?.count != null) count = page.count;
      if (list.length === 0) break;

      for (const item of list) {
        if (!item.currency || !item.issuer || !item.meta) continue;
        yield {
          token: toProviderToken(item.currency, item.issuer, item.meta),
          issuer: toProviderIssuer(item.issuer, item.meta.issuer),
        };
      }
      offset += list.length;
      if (list.length < LIST_PAGE) break;
    }
  }

  private async getJson<T>(path: string): Promise<T | null> {
    await throttle("xrplmeta", this.rpm);
    try {
      const res = await safeFetch<T>(`${this.baseUrl}${path}`, { as: "json" });
      if (res.status < 200 || res.status >= 300) {
        log.debug({ path, status: res.status }, "xrplmeta non-2xx");
        return null;
      }
      return res.data;
    } catch (err) {
      log.debug({ err, path }, "xrplmeta request failed");
      return null;
    }
  }
}

function toProviderToken(
  currency: string,
  issuer: string,
  meta: { token?: XrplMetaTokenMeta; issuer?: XrplMetaIssuerMeta },
): ProviderToken {
  const tk = meta.token ?? {};
  const iss = meta.issuer ?? {};
  const icon = tk.icon ?? iss.icon ?? null;
  return {
    currency,
    issuer,
    name: tk.name ?? iss.name ?? null,
    description: tk.description ?? tk.desc ?? iss.description ?? null,
    iconUri: icon ? canonicalizeUri(icon) : null,
    domain: iss.domain ?? null,
    trustLevel: tk.trust_level ?? (iss.kyc || iss.trusted ? 2 : 0),
    links: linksFrom(tk.urls ?? tk.weblinks),
    raw: { meta },
  };
}

function toProviderIssuer(address: string, iss?: XrplMetaIssuerMeta): ProviderIssuer | null {
  if (!iss || (!iss.name && !iss.domain && !iss.twitter && !iss.icon)) return null;
  return {
    address,
    name: iss.name ?? null,
    description: iss.description ?? null,
    iconUri: iss.icon ? canonicalizeUri(iss.icon) : null,
    twitter: iss.twitter ?? null,
    domain: iss.domain ?? null,
    verified: Boolean(iss.kyc || iss.trusted),
  };
}

function linksFrom(weblinks?: { url: string; type?: string }[]): Record<string, string> | null {
  if (!weblinks?.length) return null;
  const out: Record<string, string> = {};
  for (const w of weblinks) if (w.url) out[w.type ?? "website"] = w.url;
  return Object.keys(out).length ? out : null;
}
