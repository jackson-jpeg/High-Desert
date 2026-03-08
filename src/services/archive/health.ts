/**
 * Client-side archive.org health check with local caching.
 * Calls /api/archive/health and caches the result for 5 minutes.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cached: { up: boolean; checkedAt: number } | null = null;

/**
 * Check if archive.org is up. Returns cached result if fresh.
 * Never throws — returns `{ up: false }` on any failure.
 */
export async function checkArchiveHealth(): Promise<{ up: boolean }> {
  // Return cached result if still fresh
  if (_cached && Date.now() - _cached.checkedAt < CACHE_TTL) {
    return { up: _cached.up };
  }

  try {
    const res = await fetch("/api/archive/health", {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    _cached = { up: data.up ?? false, checkedAt: Date.now() };
    return { up: _cached.up };
  } catch {
    _cached = { up: false, checkedAt: Date.now() };
    return { up: false };
  }
}

/** Clear the cached result (e.g. when user retries playback). */
export function clearHealthCache() {
  _cached = null;
}
