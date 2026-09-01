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

/** xrplmeta metadata fields are loosely typed — coerce anything non-string to null. */
function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function canon(v: unknown): string | null {
  const str = s(v);
  if (!str) return null;
  const c = canonicalizeUri(str);
  return c || null;
}

function toProviderToken(
  currency: string,
  issuer: string,
  meta: { token?: XrplMetaTokenMeta; issuer?: XrplMetaIssuerMeta },
): ProviderToken {
  const tk = meta.token ?? {};
  const iss = meta.issuer ?? {};
  return {
    currency,
    issuer,
    name: s(tk.name) ?? s(iss.name),
    description: s(tk.description) ?? s(tk.desc) ?? s(iss.description),
    iconUri: canon(tk.icon) ?? canon(iss.icon),
    domain: s(iss.domain),
    trustLevel: typeof tk.trust_level === "number" ? tk.trust_level : iss.kyc || iss.trusted ? 2 : 0,
    links: linksFrom(tk.urls ?? tk.weblinks),
    raw: { meta },
  };
}

function toProviderIssuer(address: string, iss?: XrplMetaIssuerMeta): ProviderIssuer | null {
  if (!iss) return null;
  const name = s(iss.name);
  const domain = s(iss.domain);
  const twitter = s(iss.twitter);
  const iconUri = canon(iss.icon);
  if (!name && !domain && !twitter && !iconUri) return null;
  return {
    address,
    name,
    description: s(iss.description),
    iconUri,
    twitter,
    domain,
    verified: Boolean(iss.kyc || iss.trusted),
  };
}

function linksFrom(weblinks?: unknown): Record<string, string> | null {
  if (!Array.isArray(weblinks) || weblinks.length === 0) return null;
  const out: Record<string, string> = {};
  for (const w of weblinks) {
    const url = s((w as { url?: unknown })?.url);
    if (url) out[s((w as { type?: unknown })?.type) ?? "website"] = url;
  }
  return Object.keys(out).length ? out : null;
}
