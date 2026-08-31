import { throttle } from "../ratelimit.ts";
import { safeFetch } from "../safe-fetch.ts";
import { canonicalizeUri } from "../uri.ts";
import type { ProviderIssuer, ProviderToken, TokenInfoProvider } from "./types.ts";

export interface XrplToOptions {
  baseUrl?: string;
  requestsPerMinute?: number;
}

interface XrplToToken {
  md5?: string;
  name?: string;
  user?: string;
  domain?: string;
  verified?: number | boolean;
  kyc?: boolean;
  ext?: string;
  description?: string;
  social?: Record<string, string> | null;
  links?: Record<string, string> | null;
  issuer?: string;
  currency?: string;
}

/** xrpl.to public API — token + issuer metadata. Keyed by `{issuer}-{currency}` slug. */
export class XrplToProvider implements TokenInfoProvider {
  readonly name = "xrplto";
  private readonly baseUrl: string;
  private readonly rpm: number;

  constructor(opts: XrplToOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.xrpl.to/api").replace(/\/+$/, "");
    this.rpm = opts.requestsPerMinute ?? 240;
  }

  async fetchToken(currency: string, issuer: string): Promise<ProviderToken | null> {
    const t = await this.getToken(`${issuer}-${currency}`);
    if (!t) return null;
    return {
      currency,
      issuer,
      name: t.name ?? t.user ?? null,
      description: t.description ?? null,
      iconUri: t.md5 ? canonicalizeUri(`https://s1.xrpl.to/token/${t.md5}`) : null,
      domain: t.domain ?? null,
      trustLevel: Number(t.verified) === 1 || t.verified === true ? 3 : t.kyc ? 2 : 0,
      links: pickLinks(t),
      raw: t,
    };
  }

  async fetchIssuer(address: string): Promise<ProviderIssuer | null> {
    // xrpl.to has no issuer-only endpoint; nothing to return without a currency.
    void address;
    return null;
  }

  private async getToken(slug: string): Promise<XrplToToken | null> {
    await throttle("xrplto", this.rpm);
    try {
      const res = await safeFetch<{ success?: boolean; token?: XrplToToken }>(
        `${this.baseUrl}/token/${encodeURIComponent(slug)}`,
        { as: "json" },
      );
      if (res.status < 200 || res.status >= 300) return null;
      return res.data.token ?? null;
    } catch {
      return null;
    }
  }
}

function pickLinks(t: XrplToToken): Record<string, string> | null {
  const src = t.links ?? t.social ?? null;
  if (src && Object.keys(src).length) return src;
  return null;
}
