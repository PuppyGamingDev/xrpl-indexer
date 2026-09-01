import { describe, expect, it } from "vitest";
import { addressToHex, hexToAddress } from "./address.ts";
import { dropsToXrp, normalizeAmount, xrpToDrops } from "./amount.ts";
import { currencyToString, isXrp, stringToCurrency } from "./currency.ts";
import { cipherTaxon, parseNftId } from "./nft.ts";
import { hexToUtf8, stripNul } from "./hex.ts";
import { parseMptIssuanceId } from "./mpt.ts";
import { dateToRippleTime, rippleTimeToIso } from "./time.ts";

const ISSUER = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"; // Bitstamp, a well-known account
const ISSUER_HEX = "B5F762798A53D543A014CAF8B297CFF8F2F937E8";

describe("address", () => {
  it("round-trips r-address <-> AccountID hex", () => {
    expect(addressToHex(ISSUER)).toBe(ISSUER_HEX);
    expect(hexToAddress(ISSUER_HEX)).toBe(ISSUER);
  });
  it("rejects junk", () => {
    expect(() => addressToHex("not-an-address")).toThrow();
  });
});

describe("currency", () => {
  it("passes through 3-char ISO", () => {
    expect(currencyToString("USD")).toBe("USD");
    expect(stringToCurrency("USD")).toBe("0000000000000000000000005553440000000000");
  });
  it("decodes standard 40-hex ISO form", () => {
    expect(currencyToString("0000000000000000000000005553440000000000")).toBe("USD");
  });
  it("decodes ASCII-in-hex non-standard currency (SOLO)", () => {
    expect(currencyToString("534F4C4F00000000000000000000000000000000")).toBe("SOLO");
  });
  it("knows XRP", () => {
    expect(isXrp("XRP")).toBe(true);
    expect(isXrp("0".repeat(40))).toBe(true);
    expect(currencyToString("0".repeat(40))).toBe("XRP");
  });
});

describe("amount", () => {
  it("converts drops <-> XRP", () => {
    expect(dropsToXrp("1000000")).toBe("1");
    expect(dropsToXrp("1234567")).toBe("1.234567");
    expect(dropsToXrp("-2500000")).toBe("-2.5");
    expect(xrpToDrops("1.234567")).toBe("1234567");
    expect(xrpToDrops("10")).toBe("10000000");
  });
  it("normalizes each amount shape", () => {
    expect(normalizeAmount("1000000")).toMatchObject({ kind: "xrp", value: "1" });
    expect(normalizeAmount({ currency: "USD", issuer: ISSUER, value: "5" })).toMatchObject({
      kind: "iou",
      currency: "USD",
      issuer: ISSUER,
      value: "5",
    });
    expect(
      normalizeAmount({ mpt_issuance_id: "00000C1E" + ISSUER_HEX, value: "7" }),
    ).toMatchObject({ kind: "mpt", value: "7" });
  });
});

describe("nft id", () => {
  it("taxon cipher is an involution", () => {
    for (const [t, s] of [
      [0, 3429],
      [4294967295, 1],
      [12345, 999999],
    ] as const) {
      expect(cipherTaxon(cipherTaxon(t, s), s)).toBe(t);
    }
  });
  it("slices packed fields and unscrambles the taxon", () => {
    const scrambled = cipherTaxon(1337, 42);
    const id =
      "000B" +
      "01F4" +
      ISSUER_HEX +
      scrambled.toString(16).padStart(8, "0").toUpperCase() +
      "0000002A";
    const p = parseNftId(id);
    expect(p).toMatchObject({
      flags: 0x000b,
      transferFee: 500,
      issuer: ISSUER,
      taxon: 1337,
      sequence: 42,
    });
  });
});

describe("mpt id", () => {
  it("splits sequence + issuer", () => {
    const id = "00000C1E" + ISSUER_HEX;
    expect(parseMptIssuanceId(id)).toMatchObject({ sequence: 0x0c1e, issuer: ISSUER });
  });
});

describe("time", () => {
  it("maps the Ripple epoch", () => {
    expect(rippleTimeToIso(0)).toBe("2000-01-01T00:00:00.000Z");
    expect(dateToRippleTime(new Date("2000-01-01T00:00:00Z"))).toBe(0);
  });
});

describe("NUL byte safety (Postgres cannot store U+0000)", () => {
  const NUL = String.fromCharCode(0);
  it("stripNul removes it", () => {
    expect(stripNul("a" + NUL + "b" + NUL)).toBe("ab");
    expect(stripNul("clean")).toBe("clean");
  });
  it("hexToUtf8 drops embedded NUL", () => {
    expect(hexToUtf8("680069")).toBe("hi");           // 'h' NUL 'i'
    expect(hexToUtf8("697066732e696f")).toBe("ipfs.io");
  });
  it("currencyToString never returns a NUL", () => {
    // standard-form code with a NUL in the ISO slot -> falls back to hex
    const weird = "0000000000000000000000004100420000000000";
    const out = currencyToString(weird);
    expect(out.includes(NUL)).toBe(false);
  });
});
