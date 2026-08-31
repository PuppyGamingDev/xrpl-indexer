/** XRPL uses seconds since 2000-01-01T00:00:00Z (the "Ripple Epoch"). */
export const RIPPLE_EPOCH_OFFSET = 946_684_800;

export function rippleTimeToDate(rippleSeconds: number): Date {
  return new Date((rippleSeconds + RIPPLE_EPOCH_OFFSET) * 1000);
}

export function dateToRippleTime(date: Date): number {
  return Math.floor(date.getTime() / 1000) - RIPPLE_EPOCH_OFFSET;
}

export function rippleTimeToIso(rippleSeconds: number): string {
  return rippleTimeToDate(rippleSeconds).toISOString();
}
