import { currencyToString } from "./currency.ts";

export interface XrplIouAmount {
  currency: string;
  issuer: string;
  value: string;
}
export interface XrplMptAmount {
  mpt_issuance_id: string;
  value: string;
}
export type XrplAmount = string | XrplIouAmount | XrplMptAmount;

export interface NormalizedAmount {
  kind: "xrp" | "iou" | "mpt";
  /** Decimal string in whole units (drops already converted to XRP). */
  value: string;
  currency: string | null;
  issuer: string | null;
  mptIssuanceId: string | null;
}

const DROPS_PER_XRP = 1_000_000n;

/** "1000000" drops -> "1" ; "1234567" -> "1.234567". Handles negatives. */
export function dropsToXrp(drops: string | bigint): string {
  const neg = typeof drops === "string" ? drops.startsWith("-") : drops < 0n;
  const abs = (typeof drops === "string" ? BigInt(drops.replace("-", "")) : drops < 0n ? -drops : drops);
  const whole = abs / DROPS_PER_XRP;
  const frac = (abs % DROPS_PER_XRP).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function xrpToDrops(xrp: string): string {
  const neg = xrp.startsWith("-");
  const parts = xrp.replace("-", "").split(".");
  const whole = parts[0] || "0";
  const frac = parts[1] ?? "";
  const drops = BigInt(whole) * DROPS_PER_XRP + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
  return `${neg ? "-" : ""}${drops}`;
}

export function normalizeAmount(amount: XrplAmount): NormalizedAmount {
  if (typeof amount === "string") {
    return { kind: "xrp", value: dropsToXrp(amount), currency: "XRP", issuer: null, mptIssuanceId: null };
  }
  if ("mpt_issuance_id" in amount) {
    return {
      kind: "mpt",
      value: amount.value,
      currency: null,
      issuer: null,
      mptIssuanceId: amount.mpt_issuance_id,
    };
  }
  return {
    kind: "iou",
    value: amount.value,
    currency: currencyToString(amount.currency),
    issuer: amount.issuer,
    mptIssuanceId: null,
  };
}
