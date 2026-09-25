import { fetchNowPlaying, type NowPlaying } from "@/services/stats/client";

/**
 * The one client-side source of every presence number on the site.
 *
 * The tab badge, the status bar, the mobile sheet, On Air and Signal Traffic's
 * "now" tile used to read two endpoints on two clocks — the shell polled
 * /api/stats/active every 60s, On Air polled /api/stats/now every 20s — and
 * the badge subtracted one. One screen once read 7, 8 and 10 "online" at the
 * same moment. Now there is one poll, one snapshot, and every surface renders
 * that snapshot, so they cannot disagree.
 *
 * Reference-counted: the first subscriber starts the poll and the last one
 * stops it. The poll pauses while the tab is hidden (nobody is reading it) and
 * refreshes the moment it comes back. The heartbeat that *announces* this tab
 * is separate (`usePresence`) and keeps running while hidden.
 */

/** Fast enough to feel live, slow enough to be two indexed reads a minute. */
export const NOW_POLL_MS = 20_000;

export interface NowSnapshot extends NowPlaying {
  /** True until the first answer arrives. */
  loading: boolean;
  /**
   * Increments with every answer. Surfaces render it as `data-presence-poll`,
   * so a live check can tell "two surfaces disagree" from "read mid-update".
   */
  poll: number;
}

const INITIAL: NowSnapshot = {
  online: 0,
  listening: 0,
  live: 0,
  onAir: [],
  recent: [],
  loading: true,
  poll: 0,
};

let snapshot: NowSnapshot = INITIAL;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let inflight: Promise<void> | null = null;

function publish(next: NowSnapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

/** Fetch now and publish to every subscriber. Concurrent calls share one fetch. */
export function refreshNow(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetchNowPlaying()
    .then((next) => {
      publish({ ...next, loading: false, poll: snapshot.poll + 1 });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function start(): void {
  if (timer) return;
  void refreshNow();
  timer = setInterval(() => void refreshNow(), NOW_POLL_MS);
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function onVisibility(): void {
  if (document.visibilityState === "visible") start();
  else stop();
}

export function subscribeNow(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

export function getNowSnapshot(): NowSnapshot {
  return snapshot;
}

export function getServerNowSnapshot(): NowSnapshot {
  return INITIAL;
}

/** Tests only: forget the snapshot and any running poll. */
export function resetNowFeedForTests(): void {
  stop();
  listeners.clear();
  inflight = null;
  snapshot = INITIAL;
}

/** What a presence surface is handed: the two numbers and the poll they came from. */
export interface LivePresence {
  online: number;
  listening: number;
  poll: number;
}

export type PresenceSurface = "badge" | "status-bar" | "mobile-sheet" | "on-air" | "signal-traffic" | "live";

/**
 * The attributes every presence surface renders on the element that shows the
 * number. `highdesert-status` reads them from the live site and FAILs if two
 * surfaces on one page show different numbers for the same poll.
 */
export function presenceAttrs(surface: PresenceSurface, p: LivePresence & { live?: number }) {
  return {
    "data-presence": surface,
    "data-online": p.online,
    "data-listening": p.listening,
    // The Live screen also shows how many are tuned in; the other surfaces do not.
    ...(p.live !== undefined ? { "data-live": p.live } : {}),
    "data-presence-poll": p.poll,
  };
}
