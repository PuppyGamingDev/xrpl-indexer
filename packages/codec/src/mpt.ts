import { hexToAddress } from "./address.ts";
import { fromHex, isHex } from "./hex.ts";

export interface ParsedMptId {
  sequence: number;
  issuer: string;
  issuerHex: string;
}

/**
 * Decode a 48-hex MPTokenIssuanceID.
 * Layout: sequence(4, big-endian) | issuer AccountID(20)
 */
export function parseMptIssuanceId(id: string): ParsedMptId {
  if (!isHex(id, 24)) throw new Error(`invalid MPTokenIssuanceID: ${id}`);
  const buf = fromHex(id);
  const sequence = buf.readUInt32BE(0);
  const issuerHex = buf.subarray(4, 24).toString("hex").toUpperCase();
  return { sequence, issuerHex, issuer: hexToAddress(issuerHex) };
}

export const MPT_FLAGS = {
  CanLock: 0x0002,
  RequireAuth: 0x0004,
  CanEscrow: 0x0008,
  CanTrade: 0x0010,
  CanTransfer: 0x0020,
  CanClawback: 0x0040,
} as const;
