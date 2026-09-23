/**
 * In-memory sliding-window rate limiter.
 *
 * Correct here because production is one long-lived `next start` process (see
 * CLAUDE.md, Deployment). It is the inner layer: nginx `limit_req` on the POST
 * stats routes is the outer one (deploy/nginx/highdesert.conf) and sheds a
 * flood before it reaches Node at all.
 *
 * Keys are `<route>:<clientKey>` — see `getClientKey`, which buckets IPv6 on
 * the /64. The full v6 address used to be the key, which gave any home
 * connection 2^64 separate budgets (HD-007).
 *
 * ## Bounded memory, and what happens when it is full
 *
 * Every new key used to add a Map entry, and the only thing that removed one
 * was an O(n) sweep run *synchronously inside a request*. A flood of fresh keys
 * therefore grew the Map without bound and made one unlucky request per five
 * minutes pay for walking all of it.
 *
 * Now the Map holds at most `MAX_KEYS` entries, ordered least-recently-used
 * first (a hit re-inserts its key at the end). Admitting a new key into a full
 * Map evicts, oldest first, a batch of entries that are **not currently
 * limiting their client**. Entries that are blocking someone right now are
 * skipped — moved to the back — so a flood of fresh keys cannot launder a client that is already
 * over its limit back into a fresh budget. The scan is bounded
 * (`EVICTION_SCAN`); if it finds only blocking entries, the oldest of those are
 * evicted anyway, because the memory bound is absolute and the process must not
 * fall over.
 *
 * What that costs, stated plainly: evicting a non-blocking entry forgets up to
 * `maxRequests - 1` requests that client made this window, so it can make that
 * many more. Reaching the fall-back (evicting a *blocking* entry) takes more
 * than MAX_KEYS distinct buckets all over their limits at once — i.e. an
 * attacker holding tens of thousands of IPv4 addresses or /64s, who already has
 * that many fresh budgets without our help. Per-client limiting cannot stop
 * that; nginx and the per-key heartbeat cap (`recordHeartbeat`) are what bound
 * it. Nothing here ever fails *open* for everyone, and nothing grows.
 *
 * ## The sweep is off the request path
 *
 * Expired entries are reclaimed by an unref'd interval, installed once per
 * process on first use. `unref` so the timer never keeps a process (a test
 * runner, a build worker) alive on its own account.
 */

import { clientKey } from "./client-key";

interface RateLimitEntry {
  /** Allowed requests inside the window, oldest first. Never longer than `max`. */
  timestamps: number[];
  /** The limit and window the entry was last checked with, for eviction. */
  max: number;
  windowMs: number;
}

/**
 * Enough for every distinct client the site sees in a window many times over
 * (14 routes × a few hundred visitors), small enough that a full Map is a few
 * megabytes: each entry holds at most `maxRequests` (≤60) numbers.
 */
export const MAX_KEYS = 20_000;
/**
 * Entries freed per eviction pass. Evicting in batches rather than one at a
 * time is not a tuning detail: a V8 Map leaves a tombstone for each deleted
 * entry until it rehashes, so "delete the first entry" repeated per request
 * walks an ever-longer run of tombstones — quadratic under exactly the flood
 * this exists for (a 100k-key test took minutes). One pass per 5% of the cap
 * makes it amortised O(1).
 */
const EVICT_BATCH = Math.max(1, Math.floor(MAX_KEYS / 20));
/** How many entries one pass may look at before giving up on non-blocking ones. */
const EVICTION_SCAN = EVICT_BATCH * 4;
export const SWEEP_INTERVAL_MS = 60_000;

const store = new Map<string, RateLimitEntry>();

/** Is this entry refusing its client right now? */
function isBlocking(entry: RateLimitEntry, now: number): boolean {
  const n = entry.timestamps.length;
  // Timestamps are sorted, so the entry is at its limit iff the max-th newest
  // one is still inside the window.
  return n >= entry.max && entry.timestamps[n - entry.max] > now - entry.windowMs;
}

function evict(now: number): void {
  let freed = 0;
  let scanned = 0;
  const blocking: [string, RateLimitEntry][] = [];
  for (const [key, entry] of store) {
    if (freed >= EVICT_BATCH || scanned >= EVICTION_SCAN) break;
    scanned++;
    store.delete(key);
    if (isBlocking(entry, now)) blocking.push([key, entry]);
    else freed++;
  }
  // Every entry scanned was blocking someone: the bound wins (see the header),
  // and the oldest of them go. Otherwise they all go back, at the end of the
  // line, still blocking.
  const dropped = freed === 0 ? EVICT_BATCH : 0;
  for (const [key, entry] of blocking.slice(dropped)) store.set(key, entry);
}

let sweeps = 0;
/** Drop entries with nothing left inside their window. O(n), never per request. */
export function sweep(now = Date.now()): void {
  sweeps++;
  for (const [key, entry] of store) {
    const last = entry.timestamps[entry.timestamps.length - 1];
    if (last === undefined || last <= now - entry.windowMs) store.delete(key);
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweep(), SWEEP_INTERVAL_MS);
  (sweepTimer as { unref?: () => void }).unref?.();
}

/** For tests: how many entries are held, and how many sweeps have run. */
export function rateLimitStats(): { size: number; sweeps: number } {
  return { size: store.size, sweeps };
}

export function rateLimit(
  key: string,
  { maxRequests = 10, windowMs = 60_000 }: { maxRequests?: number; windowMs?: number } = {},
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  ensureSweeper();
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (entry) {
    // Most recently used goes to the back of the eviction order.
    store.delete(key);
  } else {
    if (store.size >= MAX_KEYS) evict(now);
    entry = { timestamps: [], max: maxRequests, windowMs };
  }
  entry.max = maxRequests;
  entry.windowMs = windowMs;
  store.set(key, entry);

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: oldest + windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

/** The client address as the proxy reported it. For logging; key on `getClientKey`. */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * The bucket to rate-limit, cap or hash a request on: the IPv4 address, or the
 * IPv6 /64. See `clientKey` in ./client-key.ts.
 */
export function getClientKey(request: Request): string {
  return clientKey(getClientIp(request));
}
