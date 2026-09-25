/**
 * Where the live station meets the player's own start path.
 *
 * Tuning in plays the scheduled show through the ordinary play path —
 * `hd:play-episode` → the layout's handler → `playEpisode()` — so the outage
 * gate, the watchdog, the mirror failover and the play report all apply to it
 * exactly as they do to a show picked from the library. Three things differ,
 * and this module is the whole of how the player learns about them:
 *
 *   start position  the station's offset into the show, computed at the moment
 *                   `playEpisode()` assigns the source — not the listener's own
 *                   saved position (`liveStartFor`)
 *   counting        one listen per show per client: tuning out and back in to
 *                   the same show, a resync, a seek or a failover never counts
 *                   again; the next show counts once (`claimLiveListen`)
 *   the end         a live show ending does not advance the queue — the station
 *                   decides what comes next (`takeLiveEnded`)
 *
 * No React, no store: the player calls in synchronously on its hot path.
 */

import type { Episode } from "@/db/schema";

export interface LiveStart {
  fileHash: string;
  /** Identifies one airing of one show: `${slot.start}:${fileHash}`. */
  slotKey: string;
  /** Seconds into the show the station is at *now*. Called at play time. */
  startAt: () => number;
}

let live: LiveStart | null = null;
/** Airings already counted by this client. Bounded: a day is ~10 slots. */
const counted = new Set<string>();
const COUNTED_MAX = 64;
let endedHandler: (() => void) | null = null;

/** Tune the player to an airing, or (null) out of live mode. */
export function setLiveStart(next: LiveStart | null): void {
  live = next;
}

export function currentLiveStart(): LiveStart | null {
  return live;
}

function matches(episode: Pick<Episode, "fileHash"> | null | undefined): boolean {
  return !!live && !!episode && episode.fileHash === live.fileHash;
}

/**
 * Where to start `episode` if it is the show on the air, else null (the
 * caller's own rule applies). Never negative.
 */
export function liveStartFor(episode: Pick<Episode, "fileHash">): number | null {
  if (!matches(episode)) return null;
  const t = live!.startAt();
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * Should this start of `episode` count as a listen?
 *
 *   null   not a live airing — the ordinary rules apply
 *   true   the first time this client has started this airing: count it
 *   false  already counted (re-tuned to the same show): do not
 */
export function claimLiveListen(episode: Pick<Episode, "fileHash">): boolean | null {
  if (!matches(episode)) return null;
  const key = live!.slotKey;
  if (counted.has(key)) return false;
  counted.add(key);
  while (counted.size > COUNTED_MAX) counted.delete(counted.values().next().value!);
  return true;
}

/** The live controller's `ended` handler. */
export function setLiveEndedHandler(fn: (() => void) | null): void {
  endedHandler = fn;
}

/**
 * The element reported `ended` for `episode`. If it is the live airing, hand it
 * to the station (station ID, then the next show) and return true — the
 * caller must then leave the queue alone.
 */
export function takeLiveEnded(episode: Pick<Episode, "fileHash"> | null): boolean {
  if (!matches(episode) || !endedHandler) return false;
  endedHandler();
  return true;
}

export const __testing = {
  reset() {
    live = null;
    counted.clear();
    endedHandler = null;
  },
};
