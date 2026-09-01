import { describe, expect, it, vi } from "vitest";
import { runDiscovery } from "./discovery.ts";
import { handleNftCollection } from "./handlers/nft-collection.ts";
import type { EnrichContext } from "./context.ts";

/** A drizzle-ish insert chain that just resolves. */
function fakeInsert() {
  const chain = {
    values: () => chain,
    onConflictDoNothing: async () => undefined,
    onConflictDoUpdate: async () => undefined,
  };
  return chain;
}

describe("runDiscovery", () => {
  it("enqueues one nft.collection per issuer, keyed by address", async () => {
    const enqueued: { queue: string; rows: { data: unknown; key?: string }[] }[] = [];
    // scan() does execute(set timeout), execute(set parallel), execute(query) —
    // so the real discovery queries land on calls 3, 6, 9 (issuers, nft, token).
    let calls = 0;
    const txExecute = vi.fn(async () => {
      calls++;
      if (calls === 3) return [{ issuer: "rA" }, { issuer: "rB" }];
      return [];
    });
    const ctx = {
      db: {
        transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: txExecute })),
        execute: txExecute,
      },
      jobs: {
        enqueueMany: vi.fn(async (queue: string, rows: { data: unknown; key?: string }[]) => {
          enqueued.push({ queue, rows });
        }),
      },
      providers: { nftCatalog: [{}], tokenInfo: [], tokenCatalog: [] },
    } as unknown as EnrichContext;

    await runDiscovery(ctx, ["nft", "token"]);

    const coll = enqueued.find((e) => e.queue === "nft.collection")!;
    expect(coll.rows).toEqual([
      { data: { issuer: "rA" }, key: "issuer:rA" },
      { data: { issuer: "rB" }, key: "issuer:rB" },
    ]);
  });

  it("skips the bulk path when no NFT catalog provider is configured", async () => {
    const enqueued: string[] = [];
    const exec = vi.fn(async () => []);
    const ctx = {
      db: {
        execute: exec,
        transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: exec })),
      },
      jobs: { enqueueMany: vi.fn(async (q: string) => void enqueued.push(q)) },
      providers: { nftCatalog: [], tokenInfo: [], tokenCatalog: [] },
    } as unknown as EnrichContext;

    await runDiscovery(ctx, ["nft"]);
    expect(enqueued).not.toContain("nft.collection");
  });
});

describe("handleNftCollection", () => {
  it("streams the issuer catalog, stubs NFTs (incl. burned) and marks the catalog", async () => {
    const inserts: unknown[][] = [];
    const live = "000800000000000000000000000000000000000000000000000000000000000A";
    const burnt = "000800000000000000000000000000000000000000000000000000000000000B";

    const provider = {
      // eslint-disable-next-line require-yield
      async *fetchIssuerNfts(_issuer: string, opts?: { includeBurned?: boolean }) {
        expect(opts?.includeBurned).toBe(true);
        yield {
          nftTokenId: live,
          name: "Live",
          description: null,
          imageUri: "ipfs://x",
          mediaUri: null,
          mediaType: "image" as const,
          attributes: null,
          collectionName: "Coll",
          uri: "ipfs://x",
          burned: false,
          burnLedger: null,
        };
        yield {
          nftTokenId: burnt,
          name: "Dead",
          description: null,
          imageUri: null,
          mediaUri: null,
          mediaType: "other" as const,
          attributes: null,
          collectionName: "Coll",
          uri: null,
          burned: true,
          burnLedger: 42,
        };
      },
    };

    const ctx = {
      db: {
        // every `select id ...` fallback resolves to an id; insert statements
        // ignore the return value.
        execute: vi.fn(async () => [{ id: 1 }]),
        insert: vi.fn((table: unknown) => {
          inserts.push([table]);
          return fakeInsert();
        }),
      },
      providers: { nftCatalog: [provider], tokenInfo: [], tokenCatalog: [] },
    } as unknown as EnrichContext;

    await handleNftCollection({ issuer: "rIssuer" }, ctx);

    // 2 nft stubs + 2 nft_meta + collection-name(s) + 1 issuer_catalog marker
    expect((ctx.db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(6);
  });
});
