export * from "./types.ts";
export { BithompProvider, type BithompOptions } from "./bithomp.ts";
export { XrplToProvider, type XrplToOptions } from "./xrplto.ts";
export { XrplMetaProvider, type XrplMetaOptions } from "./xrplmeta.ts";

import { BithompProvider } from "./bithomp.ts";
import { XrplMetaProvider } from "./xrplmeta.ts";
import { XrplToProvider } from "./xrplto.ts";
import type { NftCatalogProvider, TokenCatalogProvider, TokenInfoProvider } from "./types.ts";

export interface ProviderEnv {
  bithompApiKey?: string;
  bithompBaseUrl?: string;
  bithompRequestsPerMinute?: number;
  xrplToBaseUrl?: string;
  xrplMetaBaseUrl?: string;
  xrplMetaRequestsPerMinute?: number;
}

export interface ProviderSet {
  nftCatalog: NftCatalogProvider[];
  tokenInfo: TokenInfoProvider[];
  tokenCatalog: TokenCatalogProvider[];
}

/** Build the enabled provider set from config (a provider is off when its key/url is absent). */
export function buildProviders(env: ProviderEnv): ProviderSet {
  const nftCatalog: NftCatalogProvider[] = [];
  const tokenInfo: TokenInfoProvider[] = [];
  const tokenCatalog: TokenCatalogProvider[] = [];

  if (env.bithompApiKey) {
    nftCatalog.push(
      new BithompProvider({
        apiKey: env.bithompApiKey,
        baseUrl: env.bithompBaseUrl,
        requestsPerMinute: env.bithompRequestsPerMinute,
      }),
    );
  }
  tokenInfo.push(new XrplToProvider({ baseUrl: env.xrplToBaseUrl }));

  const xrplMeta = new XrplMetaProvider({
    baseUrl: env.xrplMetaBaseUrl,
    requestsPerMinute: env.xrplMetaRequestsPerMinute,
  });
  tokenInfo.push(xrplMeta);
  tokenCatalog.push(xrplMeta);

  return { nftCatalog, tokenInfo, tokenCatalog };
}
