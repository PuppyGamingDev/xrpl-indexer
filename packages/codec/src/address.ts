import {
  decodeAccountID,
  encodeAccountID,
  isValidClassicAddress,
} from "ripple-address-codec";
import { fromHex, toHex } from "./hex.ts";

export class InvalidAddressError extends Error {
  constructor(value: string) {
    super(`invalid XRPL address: ${value}`);
    this.name = "InvalidAddressError";
  }
}

/** r-address -> 20-byte AccountID as uppercase hex (the form Clio/rippled use in `id` fields). */
export function addressToHex(address: string): string {
  if (!isValidClassicAddress(address)) throw new InvalidAddressError(address);
  return toHex(decodeAccountID(address));
}

/** 20-byte AccountID (hex or bytes) -> r-address. */
export function hexToAddress(accountIdHex: string | Uint8Array): string {
  const buf = typeof accountIdHex === "string" ? fromHex(accountIdHex) : Buffer.from(accountIdHex);
  if (buf.length !== 20) throw new InvalidAddressError(`${buf.length}-byte AccountID`);
  return encodeAccountID(buf);
}

export function isValidAddress(address: string): boolean {
  return isValidClassicAddress(address);
}

/** The canonical "black hole" accounts issuers hand control to. */
export const BLACKHOLE_ADDRESSES: ReadonlySet<string> = new Set([
  "rrrrrrrrrrrrrrrrrrrrrhoLvTp", // ACCOUNT_ZERO
  "rrrrrrrrrrrrrrrrrrrrBZbvji", // ACCOUNT_ONE
  "rrrrrrrrrrrrrrrrrNAMEtxvNvQ", // name reservation
  "rrrrrrrrrrrrrrrrrrrn5RM1rHd", // NaN address
]);
