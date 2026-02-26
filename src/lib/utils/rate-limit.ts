/**
 * Token-bucket rate limiter for archive.org API calls.
 * Enforces 15 requests per minute to prevent 429 errors during bulk scraping.
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const store = new Map<string, TokenBucket>();
const RATE_LIMIT_TOKENS = 15;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// Cleanup stale buckets every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  // Remove buckets older than 5 minutes of inactivity
  for (const [key, bucket] of store) {
    if (now - bucket.lastRefill > 5 * 60_000) {
      store.delete(key);
    }
  }
}

export function rateLimit(
  key: string,
  { maxRequests = RATE_LIMIT_TOKENS, windowMs = RATE_LIMIT_WINDOW_MS }: { maxRequests?: number; windowMs?: number } = {},
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  cleanup();
  const now = Date.now();
  
  let bucket = store.get(key);
  if (!bucket) {
    bucket = { tokens: maxRequests, lastRefill: now };
    store.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor((elapsed / windowMs) * maxRequests);
  bucket.tokens = Math.min(maxRequests, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  if (bucket.tokens <= 0) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.ceil((1 / maxRequests) * windowMs),
    };
  }

  bucket.tokens--;
  return {
    allowed: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterMs: 0,
  };
}

export function createArchiveRateLimiter() {
  return {
    check: () => rateLimit('archive.org', { maxRequests: 15, windowMs: 60_000 }),
  };
}

export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
