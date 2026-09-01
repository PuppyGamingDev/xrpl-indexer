import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.fn();
vi.mock("./safe-fetch.ts", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

const { BithompProvider } = await import("./providers/bithomp.ts");
const { XrplMetaProvider } = await import("./providers/xrplmeta.ts");

const ok = (data: unknown, url = "http://x") => ({ status: 200, url, data });

beforeEach(() => safeFetch.mockReset());

describe("BithompProvider.fetchIssuerNfts", () => {
  it("requests metadata (not assets) and passes deleted=true when includeBurned", async () => {
    const urls: string[] = [];
    safeFetch.mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve(
        ok({
          nfts: [
            { nftokenID: "00080000" + "0".repeat(40) + "00000000" + "00000001", uri: "6970667300", metadata: { name: "A" } },
            {
              nftokenID: "00080000" + "0".repeat(40) + "00000000" + "00000002",
              metadata: { name: "B" },
              deletedAt: "2023-01-01",
              deletedLedgerIndex: 77123,
            },
          ],
          summary: { totalNfts: 2 },
        }),
      );
    });

    const p = new BithompProvider({ apiKey: "k", requestsPerMinute: 0 });
    const out = [];
    for await (const n of p.fetchIssuerNfts("rIssuer", { includeBurned: true })) out.push(n);

    expect(urls[0]).toContain("metadata=true");
    expect(urls[0]).not.toContain("assets=true");
    expect(urls[0]).toContain("deleted=true");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "A", burned: false, burnLedger: null });
    expect(out[1]).toMatchObject({ name: "B", burned: true, burnLedger: 77123 });
  });

  it("omits deleted param by default", async () => {
    let seen = "";
    safeFetch.mockImplementation((url: string) => {
      seen = url;
      return Promise.resolve(ok({ nfts: [], summary: { totalNfts: 0 } }));
    });
    const p = new BithompProvider({ apiKey: "k", requestsPerMinute: 0 });
    for await (const _ of p.fetchIssuerNfts("rIssuer")) void _;
    expect(seen).not.toContain("deleted=true");
  });
});

describe("XrplMetaProvider.fetchAllTokens", () => {
  it("paginates by offset until count is reached", async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({
        currency: `C${from + i}`,
        issuer: `rIss${from + i}`,
        meta: { token: { name: `T${from + i}` }, issuer: { name: `I${from + i}`, kyc: true } },
      }));
    safeFetch.mockImplementationOnce(() => Promise.resolve(ok({ count: 150, tokens: page(100, 0) })));
    safeFetch.mockImplementationOnce(() => Promise.resolve(ok({ count: 150, tokens: page(50, 100) })));

    const p = new XrplMetaProvider({ requestsPerMinute: 0 });
    const out = [];
    for await (const t of p.fetchAllTokens()) out.push(t);

    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(150);
    expect(out[0]).toMatchObject({
      token: { currency: "C0", issuer: "rIss0", name: "T0", trustLevel: 2 },
      issuer: { address: "rIss0", name: "I0", verified: true },
    });
  });

  it("stops on a short page", async () => {
    safeFetch.mockImplementationOnce(() =>
      Promise.resolve(ok({ count: 999, tokens: [{ currency: "C", issuer: "rI", meta: { token: { name: "x" } } }] })),
    );
    const p = new XrplMetaProvider({ requestsPerMinute: 0 });
    const out = [];
    for await (const t of p.fetchAllTokens()) out.push(t);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
  });
});
