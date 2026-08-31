/**
 * Process-wide sliding-window rate limiter, shared across all workers in a
 * process. `throttle(key, perMinute)` resolves when a request slot is free.
 */
const windows = new Map<string, number[]>();

export async function throttle(key: string, perMinute: number): Promise<void> {
  if (perMinute <= 0) return;
  const windowMs = 60_000;
  for (;;) {
    const now = Date.now();
    const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length < perMinute) {
      hits.push(now);
      windows.set(key, hits);
      return;
    }
    const waitMs = windowMs - (now - hits[0]!) + 5;
    await sleep(waitMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
