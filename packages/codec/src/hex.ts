/** Uppercase hex helpers for the BLOB-ish fields XRPL APIs hand back. */

export function toHex(buf: Uint8Array): string {
  return Buffer.from(buf).toString("hex").toUpperCase();
}

export function fromHex(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return Buffer.from(clean, "hex");
}

export function isHex(s: string, bytes?: number): boolean {
  if (/[^0-9a-fA-F]/.test(s) || s.length % 2 !== 0) return false;
  return bytes === undefined ? true : s.length === bytes * 2;
}

/** Remove U+0000 which Postgres text and jsonb columns cannot store. */
export function stripNul(s: string): string {
  return s.indexOf("\u0000") === -1 ? s : s.replace(/\u0000/g, "");
}

/**
 * Decode a hex-encoded UTF-8 blob (e.g. NFToken.URI, AccountRoot.Domain).
 * NUL bytes are stripped because Postgres rejects them.
 */
export function hexToUtf8(hex: string): string {
  return stripNul(fromHex(hex).toString("utf8"));
}

export function utf8ToHex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex").toUpperCase();
}
