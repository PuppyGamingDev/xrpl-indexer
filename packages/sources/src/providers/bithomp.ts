import { createLogger } from "@xrpl-indexer/core/logger";
import { classifyMediaType } from "../metadata/media-type.ts";
import { parseNftMetadata } from "../metadata/nft.ts";
import { throttle, sleep } from "../ratelimit.ts";
import { safeFetch } from "../safe-fetch.ts";
import { canonicalizeUri } from "../uri.ts";
import type { CatalogNft, NftCatalogOptions, NftCatalogProvider } from "./types.ts";

const log = createLogger("sources.bithomp");
const MAX_429_RETRIES = 2;

export interface BithompOptions {
  apiKey: string;
  baseUrl?: string;
  requestsPerMinute?: number;
  pageLimit?: number;
}

interface BithompNft {
  nftokenID?: string;
  uri?: string;
  metadata?: Record<string, unknown> | null;
  /** Present (with a timestamp) once the NFT has been burned. */
  deletedAt?: string | number | null;
  deletedLedgerIndex?: number | null;
}

export class BithompProvider implements NftCatalogProvider {
  readonly name = "bithomp";
  private readonly baseUrl: string;
  private readonly rpm: number;
  private readonly pageLimit: number;

  constructor(private readonly opts: BithompOptions) {
    if (!opts.apiKey) throw new Error("BithompProvider requires an apiKey");
    this.baseUrl = (opts.baseUrl ?? "https://bithomp.com/api/v2").replace(/\/+$/, "");
    this.rpm = opts.requestsPerMinute ?? 300;
    this.pageLimit = Math.min(opts.pageLimit ?? 1000, 1000);
  }

  async *fetchIssuerNfts(issuer: string, opts: NftCatalogOptions = {}): AsyncGenerator<CatalogNft> {
    let offset = 0;
    let total = Infinity;
    let pages = 0;

    while (offset < total) {
      if (++pages > 200) {
        log.warn({ issuer, offset }, "bithomp issuer catalog exceeded 200 pages; stopping");
        break;
      }
      const page = await this.getPage(issuer, offset, opts.includeBurned ?? false);
      const list = page.nfts ?? [];
      if (page.summary?.totalNfts != null) total = page.summary.totalNfts;
      if (list.length === 0) break;

      for (const raw of list) {
        const mapped = mapNft(raw);
        if (mapped) yield mapped;
      }
      offset += list.length;
      if (list.length < this.pageLimit) break;
    }
  }

  private async getPage(
    issuer: string,
    offset: number,
    includeBurned: boolean,
  ): Promise<{ nfts?: BithompNft[]; summary?: { totalNfts?: number } }> {
    // metadata=true returns the parsed metadata JSON inline; we deliberately do
    // NOT pass assets=true — image/media links come from the NFT's own metadata
    // (canonical ipfs://, ar://, https://), never a Bithomp CDN URL.
    let url =
      `${this.baseUrl}/nfts?issuer=${encodeURIComponent(issuer)}` +
      `&limit=${this.pageLimit}&offset=${offset}&metadata=true`;
    if (includeBurned) url += "&deleted=true";

    for (let attempt = 0; ; attempt++) {
      await throttle("bithomp", this.rpm);
      const res = await safeFetch<Record<string, unknown>>(url, {
        as: "json",
        headers: { "x-bithomp-token": this.opts.apiKey },
        timeoutMs: 20_000,
      });
      if (res.status === 429) {
        if (attempt >= MAX_429_RETRIES) throw new Error("bithomp: rate limited, retries exhausted");
        const waitMs = parseRetry(res.data) ?? 30_000;
        log.warn({ waitMs, offset }, "bithomp 429; backing off");
        await sleep(Math.min(waitMs, 600_000));
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`bithomp: HTTP ${res.status}`);
      }
      return res.data as { nfts?: BithompNft[]; summary?: { totalNfts?: number } };
    }
  }
}

function mapNft(raw: BithompNft): CatalogNft | null {
  const id = raw.nftokenID?.toUpperCase();
  if (!id) return null;

  const meta = parseNftMetadata(raw.metadata ?? {});
  const uri = raw.uri ? canonicalizeUri(raw.uri) : null;
  const imageUri = meta.imageUri ?? uri;
  const mediaUri = meta.mediaUri ?? null;
  const burned = raw.deletedAt != null || raw.deletedLedgerIndex != null;

  return {
    nftTokenId: id,
    name: meta.name,
    description: meta.description,
    imageUri,
    mediaUri,
    mediaType: classifyMediaType(mediaUri ?? imageUri ?? undefined),
    attributes: meta.attributes,
    collectionName: meta.collectionName,
    uri,
    burned,
    burnLedger: typeof raw.deletedLedgerIndex === "number" ? raw.deletedLedgerIndex : null,
  };
}

function parseRetry(body: unknown): number | null {
  const msg = typeof body === "object" && body ? String((body as { message?: string }).message ?? "") : "";
  const m = msg.match(/retry in (\d+)\s*s/i);
  return m ? Number(m[1]) * 1000 : null;
}
