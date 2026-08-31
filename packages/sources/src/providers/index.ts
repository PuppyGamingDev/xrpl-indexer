export * from "./types.ts";
export { BithompProvider, type BithompOptions } from "./bithomp.ts";
export { XrplToProvider, type XrplToOptions } from "./xrplto.ts";
export { XrplMetaProvider, type XrplMetaOptions } from "./xrplmeta.ts";

import { BithompProvider } from "./bithomp.ts";
import { XrplMetaProvider } from "./xrplmeta.ts";
import { XrplToProvider } from "./xrplto.ts";
import type { NftCatalogProvider, TokenInfoProvider } from "./types.ts";

export interface ProviderEnv {
  bithompApiKey?: string;
  bithompBaseUrl?: string;
  bithompRequestsPerMinute?: number;
  xrplToBaseUrl?: string;
  xrplMetaBaseUrl?: string;
}

/** Build the enabled provider set from config (a provider is off when its key/url is absent). */
export function buildProviders(env: ProviderEnv): {
  nftCatalog: NftCatalogProvider[];
  tokenInfo: TokenInfoProvider[];
} {
  const nftCatalog: NftCatalogProvider[] = [];
  const tokenInfo: TokenInfoProvider[] = [];

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
  tokenInfo.push(new XrplMetaProvider({ baseUrl: env.xrplMetaBaseUrl }));

  return { nftCatalog, tokenInfo };
}
