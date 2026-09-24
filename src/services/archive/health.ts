/**
 * Client-side archive.org health check, cached.
 *
 * The verdicts are cached for different lengths of time, deliberately:
 *
 *   up    5 minutes — the common case, and re-probing on every play is waste
 *   down  30 seconds — an outage verdict routes every play straight to the
 *         mirror (src/audio/sources.ts), so a stale one keeps listeners off a
 *         recovered archive.org. It used to be cached for the same 5 minutes,
 *         and a probe that merely failed to reach this server counted as
 *         "archive.org is down" for all of them.
 *
 * A probe that could not reach *this* server (offline, our 5xx) is not a
 * verdict about archive.org at all: it answers "down" for the caller's
 * immediate purposes and caches nothing.
 */

const UP_TTL = 5 * 60 * 1000;
const DOWN_TTL = 30 * 1000;

let _cached: { up: boolean; checkedAt: number } | null = null;

function fresh(now = Date.now()): boolean {
  return !!_cached && now - _cached.checkedAt < (_cached.up ? UP_TTL : DOWN_TTL);
}

/** Check if archive.org is up. Never throws. */
export async function checkArchiveHealth(): Promise<{ up: boolean }> {
  if (fresh()) return { up: _cached!.up };
  try {
    const res = await fetch("/api/archive/health", { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { up: false };
    const data = await res.json();
    _cached = { up: data.up === true, checkedAt: Date.now() };
    return { up: _cached.up };
  } catch {
    return { up: false };
  }
}

/**
 * The cached verdict, synchronously — true only for a fresh "down". Read on the
 * play path, which must not await anything before `play()` (Safari decides a
 * call was not user-initiated if a task boundary sits between the tap and it).
 */
export function archiveKnownDown(): boolean {
  return fresh() && _cached!.up === false;
}

/** Clear the cached result (e.g. when user retries playback). */
export function clearHealthCache() {
  _cached = null;
}

export const __testing = { UP_TTL, DOWN_TTL };
