import type { MediaKind } from "../metadata/media-type.ts";

/** Normalised NFT record from any external catalog provider. */
export interface ProviderNft {
  nftTokenId: string;
  name: string | null;
  description: string | null;
  imageUri: string | null;
  mediaUri: string | null;
  mediaType: MediaKind;
  attributes: unknown[] | null;
  collectionName: string | null;
}

/** Normalised token/issuer record. */
export interface ProviderToken {
  currency: string;
  issuer: string;
  name: string | null;
  description: string | null;
  iconUri: string | null;
  domain: string | null;
  trustLevel: number;
  links: Record<string, string> | null;
  raw: unknown;
}

export interface ProviderIssuer {
  address: string;
  name: string | null;
  description: string | null;
  iconUri: string | null;
  twitter: string | null;
  domain: string | null;
  verified: boolean;
}

export interface NftCatalogOptions {
  /** Include NFTs that have since been burned (Bithomp `deleted`). */
  includeBurned?: boolean;
}

/** A catalog NFT plus the fields needed to synthesise an `nft` row when we've never seen it on-ledger. */
export interface CatalogNft extends ProviderNft {
  /** Decoded on-chain URI, verbatim (canonicalised). */
  uri: string | null;
  /** True when the provider marks it burned/deleted. */
  burned: boolean;
  /** Ledger index the NFT was burned at, when the provider reports it. */
  burnLedger: number | null;
}

export interface NftCatalogProvider {
  readonly name: string;
  /** Stream every NFT for one issuer (all taxa). */
  fetchIssuerNfts(issuer: string, opts?: NftCatalogOptions): AsyncGenerator<CatalogNft>;
}

export interface TokenInfoProvider {
  readonly name: string;
  fetchToken(currency: string, issuer: string): Promise<ProviderToken | null>;
  fetchIssuer?(address: string): Promise<ProviderIssuer | null>;
}

/** A source that can enumerate the whole token set (bulk), not just one at a time. */
export interface TokenCatalogProvider {
  readonly name: string;
  fetchAllTokens(): AsyncGenerator<{ token: ProviderToken; issuer: ProviderIssuer | null }>;
}
