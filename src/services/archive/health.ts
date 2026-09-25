import { useOutageStore } from "@/stores/outage-store";

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
 *
 * Every real verdict is published to `useOutageStore`, which is what outage
 * mode — the banner, the row marks, the filter and the play path — reads. The
 * TTLs above decide when a verdict may be re-probed; `useOutageMonitor`
 * re-probes on exactly that schedule, so the published verdict is never older
 * than one TTL plus a probe.
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
    useOutageStore.getState().setArchiveUp(_cached.up);
    return { up: _cached.up };
  } catch {
    return { up: false };
  }
}

/**
 * The published verdict, synchronously — true once a probe has said "down",
 * until one says "up". Read on the play path, which must not await anything
 * before `play()` (Safari decides a call was not user-initiated if a task
 * boundary sits between the tap and it).
 *
 * It used to be "a fresh down" — false the moment the 30 s TTL lapsed, before
 * the next probe could answer. With the banner and the row marks reading the
 * store, that let a start disagree with the screen: the list said "plays from
 * the mirror", the tap went to a dead archive.org and waited out a timeout.
 */
export function archiveKnownDown(): boolean {
  return useOutageStore.getState().archiveUp === false;
}

/** When the current verdict may be re-probed, in ms from now (0 = now). */
export function msUntilReprobe(now = Date.now()): number {
  if (!_cached) return 0;
  return Math.max(0, _cached.checkedAt + (_cached.up ? UP_TTL : DOWN_TTL) - now);
}

/** Clear the cached result (e.g. when user retries playback). */
export function clearHealthCache() {
  _cached = null;
}

export const __testing = { UP_TTL, DOWN_TTL };
