import { db } from "@/db";

/**
 * Seconds actually listened, per history entry — the number behind /stats'
 * "Listened" tile.
 *
 * Nothing measured this before. The tile summed `playbackPosition`, which is
 * *where you are*, not *how long you listened*: it is reset to 0 on `ended`, so
 * finishing a three-hour show took three hours off the total, and seeking to
 * the last hour of one added an hour nobody heard. The older ListeningStats
 * banner summed `history.duration` instead, which was sounder, except that the
 * one writer of history rows (`(desktop)/layout.tsx`) always wrote `0` and
 * nothing ever updated it — so that total was 0 for everyone, forever.
 *
 * So: the 250 ms position tick reports `currentTime` here. Forward steps of at
 * most `MAX_TICK_S` between consecutive ticks count as listened; anything else
 * — a seek, a jump back, the first tick after a pause or an episode change — only
 * moves the baseline. The pending total is added to the episode's newest history
 * row at the same moments the position is saved (every 30 s, on pause, and when
 * the episode changes). An unload loses at most the last 30 s, as position does.
 */

/** Longest gap between two 250 ms ticks still counted as playback (covers 2× speed and a busy main thread). */
export const MAX_TICK_S = 2;

let base: number | null = null;
let pending = 0;

/** A position tick while playing. */
export function noteListenTick(currentTime: number): void {
  if (base !== null) {
    const dt = currentTime - base;
    if (dt > 0 && dt <= MAX_TICK_S) pending += dt;
  }
  base = currentTime;
}

/** Playback stopped or jumped: the next tick is a new baseline, not a step. */
export function breakListenTick(): void {
  base = null;
}

/** Seconds accumulated and not yet written. */
export function pendingListenSeconds(): number {
  return pending;
}

/**
 * Add everything pending to `episodeId`'s newest history row, creating one if
 * the layout's insert has not landed. Never throws; on failure the seconds are
 * kept for the next flush.
 */
export async function flushListenSeconds(episodeId: number | undefined): Promise<void> {
  const seconds = pending;
  if (!episodeId || seconds <= 0) return;
  pending = 0;
  try {
    await db.transaction("rw", db.history, async () => {
      const rows = await db.history.where("episodeId").equals(episodeId).sortBy("timestamp");
      const newest = rows[rows.length - 1];
      if (newest) {
        await db.history.update(newest.id!, { duration: (newest.duration ?? 0) + seconds });
      } else {
        await db.history.add({ episodeId, timestamp: Date.now(), duration: seconds });
      }
    });
  } catch (err) {
    pending += seconds;
    console.warn("[listen-time] flush failed:", err);
  }
}

export function resetListenTimeForTests(): void {
  base = null;
  pending = 0;
}
