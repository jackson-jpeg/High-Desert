import type { Episode } from "@/db/schema";
import { addListened } from "./history";

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

/**
 * Slack on top of the wall clock: timer jitter, and the media clock running a
 * little ahead of a tick that fired late.
 */
export const TICK_SLACK_S = 0.5;

/**
 * How far the media clock may run ahead of the wall clock and still be
 * listening (at 1x). Past that, the jump was a seek.
 */
export const WALL_RATIO = 1.25;

let base: number | null = null;
let baseWall = 0;
let pending = 0;

/**
 * A position tick while playing. `wallMs` is a monotonic clock
 * (performance.now() in the player), `rate` the element's playbackRate.
 *
 * Counted: the media time that passed, when it is no more than the wall time
 * that passed allows (2026-11-27, UI plan push 6). It used to be "steps of at
 * most 2 s between two 250 ms ticks", which assumed the tick keeps running.
 * It does not: iOS suspends the page with the screen locked and Chrome
 * throttles a hidden tab's timers to once a minute, so the first tick after
 * an hour heard on a locked phone saw a 3,600 s step, called it a seek and
 * counted nothing. /stats read "0.0h" for listeners who had heard whole
 * shows. Bounded by the wall clock, a seek forward still never counts (it
 * moves the media clock far more than the wall clock), and a pause inside
 * the gap counts only what actually played.
 */
export function noteListenTick(currentTime: number, wallMs: number, rate = 1): void {
  if (base !== null) {
    const dt = currentTime - base;
    const wall = Math.max(0, (wallMs - baseWall) / 1000);
    if (dt > 0 && dt <= wall * Math.max(1, rate) * WALL_RATIO + TICK_SLACK_S) pending += dt;
  }
  base = currentTime;
  baseWall = wallMs;
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
 * Write everything pending into Listening History for `ep` (history.ts,
 * `addListened`: the newest row when it is this show today, else a new row).
 * This is the one way a history row is made. Never throws; on failure, or
 * with no episode, the seconds are kept for the next flush.
 */
export async function flushListenSeconds(
  ep: Pick<Episode, "id" | "title" | "fileName" | "guestName"> | null | undefined,
): Promise<void> {
  const seconds = pending;
  if (!ep?.id || seconds <= 0) return;
  pending = 0;
  try {
    await addListened(ep, seconds);
  } catch (err) {
    pending += seconds;
    console.warn("[listen-time] flush failed:", err);
  }
}

export function resetListenTimeForTests(): void {
  base = null;
  baseWall = 0;
  pending = 0;
}
