import { hexToAddress } from "./address.ts";
import { fromHex, isHex } from "./hex.ts";

export const NFT_FLAGS = {
  Burnable: 0x0001,
  OnlyXRP: 0x0002,
  TrustLine: 0x0004,
  Transferable: 0x0008,
  Mutable: 0x0010,
} as const;

export interface ParsedNftId {
  flags: number;
  /** Transfer fee in basis points of 1/100000 (divide by 1000 for a percent). */
  transferFee: number;
  issuer: string;
  issuerHex: string;
  taxon: number;
  sequence: number;
}

/** rippled's taxon cipher (an involution — same function scrambles and unscrambles). */
export function cipherTaxon(taxon: number, sequence: number): number {
  return (taxon ^ ((Math.imul(sequence, 384160001) + 2459) >>> 0)) >>> 0;
}

/**
 * Decode a 64-hex NFTokenID into its packed fields.
 * Layout: flags(2) | transferFee(2) | issuer(20) | taxon(4) | sequence(4)
 */
export function parseNftId(tokenId: string): ParsedNftId {
  if (!isHex(tokenId, 32)) throw new Error(`invalid NFTokenID: ${tokenId}`);
  const buf = fromHex(tokenId);
  const flags = buf.readUInt16BE(0);
  const transferFee = buf.readUInt16BE(2);
  const issuerHex = buf.subarray(4, 24).toString("hex").toUpperCase();
  const scrambledTaxon = buf.readUInt32BE(24);
  const sequence = buf.readUInt32BE(28);
  return {
    flags,
    transferFee,
    issuerHex,
    issuer: hexToAddress(issuerHex),
    taxon: cipherTaxon(scrambledTaxon, sequence),
    sequence,
  };
}

export function nftIsTransferable(flags: number): boolean {
  return (flags & NFT_FLAGS.Transferable) !== 0;
}

export function transferFeePercent(transferFee: number): number {
  return transferFee / 1000;
}
