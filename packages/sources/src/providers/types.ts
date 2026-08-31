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

export interface NftCatalogProvider {
  readonly name: string;
  /** Stream every NFT for one issuer (all taxa). */
  fetchIssuerNfts(issuer: string): AsyncGenerator<ProviderNft>;
}

export interface TokenInfoProvider {
  readonly name: string;
  fetchToken(currency: string, issuer: string): Promise<ProviderToken | null>;
  fetchIssuer?(address: string): Promise<ProviderIssuer | null>;
}
