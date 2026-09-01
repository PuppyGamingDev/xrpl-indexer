import { fromHex, isHex, stripNul } from "./hex.ts";

const XRP = "XRP";

export function isXrp(code: string): boolean {
  return code === XRP || /^0{40}$/.test(code);
}

/**
 * Normalise any currency representation to a human string.
 *  - "XRP" / 40 zero-hex               -> "XRP"
 *  - 3-char ISO ("USD")               -> unchanged
 *  - 40-hex standard ISO form (00..)  -> the 3-char code
 *  - 40-hex non-standard              -> ASCII if fully printable, else the hex
 *
 * Guaranteed free of NUL bytes so the result is safe for Postgres text/jsonb.
 */
export function currencyToString(code: string): string {
  return stripNul(currencyToStringImpl(code));
}

function currencyToStringImpl(code: string): string {
  if (isXrp(code)) return XRP;
  if (code.length === 3) return code;

  if (isHex(code, 20)) {
    const buf = fromHex(code);
    if (buf[0] === 0x00) {
      // standard form: ISO code sits in bytes 12..15
      const iso = buf.subarray(12, 15).toString("ascii").replace(/\0+$/, "");
      return isPrintable(iso) && iso.length > 0 ? iso : code.toUpperCase();
    }
    const trimmed = buf.subarray(0, indexOfTrailingZero(buf)).toString("utf8");
    return isPrintable(trimmed) && trimmed.length > 0 ? trimmed : code.toUpperCase();
  }
  return code;
}

/** Inverse: produce the 40-hex on-ledger currency code. */
export function stringToCurrency(value: string): string {
  if (isXrp(value)) return "0".repeat(40);
  if (value.length === 3) {
    return Buffer.concat([
      Buffer.alloc(12),
      Buffer.from(value, "ascii"),
      Buffer.alloc(5),
    ])
      .toString("hex")
      .toUpperCase();
  }
  if (isHex(value, 20)) return value.toUpperCase();
  const buf = Buffer.alloc(20);
  Buffer.from(value, "utf8").copy(buf, 0, 0, 20);
  return buf.toString("hex").toUpperCase();
}

function indexOfTrailingZero(buf: Buffer): number {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0x00) end--;
  return end;
}

function isPrintable(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}
