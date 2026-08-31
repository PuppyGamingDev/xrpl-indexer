import { describe, expect, it } from "vitest";
import { isBlockedIp } from "./ip.ts";
import { canonicalizeUri, parseDataUriJson, resolveForFetch } from "./uri.ts";
import { classifyMediaType } from "./metadata/media-type.ts";
import { parseNftMetadata } from "./metadata/nft.ts";

describe("isBlockedIp", () => {
  it("blocks private / loopback / metadata / link-local", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.169.254", "100.64.0.1", "::1", "fd00::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "104.16.0.1", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
  it("treats non-literals as blocked (caller must resolve)", () => {
    expect(isBlockedIp("example.com")).toBe(true);
  });
});

describe("canonicalizeUri", () => {
  it("normalises every IPFS shape to ipfs://<cid>/<path>", () => {
    const want = "ipfs://bafybeigdyrxyz/meta.json";
    for (const input of [
      "ipfs://bafybeigdyrxyz/meta.json",
      "ipfs://ipfs/bafybeigdyrxyz/meta.json",
      "https://ipfs.io/ipfs/bafybeigdyrxyz/meta.json",
      "https://gateway.pinata.cloud/ipfs/bafybeigdyrxyz/meta.json",
      "https://bafybeigdyrxyz.ipfs.dweb.link/meta.json",
    ]) {
      expect(canonicalizeUri(input), input).toBe(want);
    }
  });
  it("normalises Arweave", () => {
    expect(canonicalizeUri("https://arweave.net/abc123")).toBe("ar://abc123");
    expect(canonicalizeUri("ar://abc123")).toBe("ar://abc123");
  });
  it("passes through https and data untouched", () => {
    expect(canonicalizeUri("https://example.com/x.json")).toBe("https://example.com/x.json");
    expect(canonicalizeUri("data:application/json,{}")).toBe("data:application/json,{}");
  });
  it("wraps a bare CID", () => {
    expect(canonicalizeUri("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBe(
      "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    );
  });
});

describe("resolveForFetch", () => {
  it("expands ipfs:// across gateways and rotates", () => {
    const gw = { ipfsGateways: ["https://a.io", "https://b.io", "https://c.io"], arweaveGateway: "https://arweave.net" };
    expect(resolveForFetch("ipfs://cid/x.json", gw, 0)[0]).toBe("https://a.io/ipfs/cid/x.json");
    expect(resolveForFetch("ipfs://cid/x.json", gw, 1)[0]).toBe("https://b.io/ipfs/cid/x.json");
  });
});

describe("parseDataUriJson", () => {
  it("decodes base64 and percent-encoded JSON", () => {
    const b64 = "data:application/json;base64," + Buffer.from('{"name":"x"}').toString("base64");
    expect(parseDataUriJson(b64)).toEqual({ name: "x" });
    expect(parseDataUriJson('data:application/json,%7B%22a%22%3A1%7D')).toEqual({ a: 1 });
  });
});

describe("classifyMediaType", () => {
  it("uses extension then declared type", () => {
    expect(classifyMediaType("x.png")).toBe("image");
    expect(classifyMediaType("x.mp4")).toBe("video");
    expect(classifyMediaType("ipfs://cid", "audio/mpeg")).toBe("audio");
    expect(classifyMediaType("x.bin")).toBe("other");
  });
});

describe("parseNftMetadata", () => {
  it("pulls the standard XLS-24 fields and canonicalises links", () => {
    const p = parseNftMetadata({
      name: "Cool #1",
      description: "hi",
      image: "https://ipfs.io/ipfs/bafcid/img.png",
      animation_url: "ipfs://vidcid/a.mp4",
      attributes: [{ trait_type: "BG", value: "Blue" }],
      collection: { name: "Cool Cats" },
    });
    expect(p).toMatchObject({
      name: "Cool #1",
      imageUri: "ipfs://bafcid/img.png",
      mediaUri: "ipfs://vidcid/a.mp4",
      mediaType: "video",
      collectionName: "Cool Cats",
    });
    expect(p.attributes).toHaveLength(1);
  });
});
