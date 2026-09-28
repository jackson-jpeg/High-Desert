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
 *   resuming        ▶ on a station held paused goes back to where the station
 *                   is *now*, not where it was paused (`takeLiveResume`)
 *   leaving         "Leave the station" stops the player outright
 *                   (`stopPlayerForLive`)
 *
 * No React, no store: the player calls in synchronously on its hot path.
 */

import type { Episode } from "@/db/schema";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/utils/safe-storage";

export interface LiveStart {
  fileHash: string;
  /** Identifies one airing of one show: `${slot.start}:${fileHash}`. */
  slotKey: string;
  /** Seconds into the show the station is at *now*. Called at play time. */
  startAt: () => number;
  /**
   * The program started this show (a slot change), not a tap. Its play() has
   * no gesture behind it, and a refusal is the station's to handle
   * (`takeLiveRefused`), not the error dialog's.
   */
  handover?: boolean;
}

let live: LiveStart | null = null;
/**
 * Airings already counted by this tab. Bounded: a day is ~10 slots. Kept in
 * sessionStorage, so a reload (a listener's, or the tab updating itself to a
 * new build, src/services/build/stale-tab.ts) does not count the same airing
 * again when they come back to it. Storage blocked: memory only, as before.
 */
export const COUNTED_MARK = "hd-live-counted";
let counted: Set<string> | null = null;
const COUNTED_MAX = 64;

function countedAirings(): Set<string> {
  if (counted) return counted;
  let saved: unknown = null;
  try {
    saved = JSON.parse(safeGetItem("session", COUNTED_MARK) ?? "null");
  } catch {
    saved = null;
  }
  counted = new Set(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : []);
  return counted;
}
let endedHandler: (() => void) | null = null;
let resumeHandler: (() => boolean) | null = null;
let stopHandler: (() => void) | null = null;

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
  const seen = countedAirings();
  if (seen.has(key)) return false;
  seen.add(key);
  while (seen.size > COUNTED_MAX) seen.delete(seen.values().next().value!);
  safeSetItem("session", COUNTED_MARK, JSON.stringify([...seen]));
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

let refusedHandler: ((detail: string) => void) | null = null;

/** The live controller's handler for a handover the browser refused. */
export function setLiveRefusedHandler(fn: ((detail: string) => void) | null): void {
  refusedHandler = fn;
}

/**
 * The browser refused play() for `episode`. If that was the station changing
 * shows by itself (screen off, tab in the background), hand it to the station
 * and return true: it records the refusal and waits for a tap to rejoin. The
 * caller must then leave the failure dialog out of it.
 */
export function takeLiveRefused(episode: Pick<Episode, "fileHash"> | null, detail: string): boolean {
  if (!matches(episode) || !live!.handover || !refusedHandler) return false;
  refusedHandler(detail);
  return true;
}

/** The live controller's resume handler. */
export function setLiveResumeHandler(fn: (() => boolean) | null): void {
  resumeHandler = fn;
}

/**
 * The listener asked to resume (▶, a headset "play"). Called synchronously at
 * the top of `resumePlayback`, inside the gesture. Returns true when the
 * station took the start over — the caller must then do nothing more. False
 * means resume the element as usual; if the station was holding paused it has
 * already moved the playhead to the live second.
 */
export function takeLiveResume(): boolean {
  return resumeHandler ? resumeHandler() : false;
}

/** The player's own stop (element torn down, store cleared), for leaving the station. */
export function setLiveStopHandler(fn: (() => void) | null): void {
  stopHandler = fn;
}

export function stopPlayerForLive(): void {
  stopHandler?.();
}

export const __testing = {
  reset() {
    live = null;
    counted = null;
    safeRemoveItem("session", COUNTED_MARK);
    endedHandler = null;
    resumeHandler = null;
    refusedHandler = null;
    stopHandler = null;
  },
  /** What a reload does to this module: memory gone, the tab's sessionStorage kept. */
  reload() {
    live = null;
    counted = null;
  },
};
