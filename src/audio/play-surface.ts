/**
 * Where a play was started, for `/api/stats/play`'s `surface`
 * (docs/usage-tracking.md).
 *
 * Every start goes through the start token (src/audio/play-session.ts), so the
 * surface is bound to the token, not guessed at count time:
 *
 *   - A caller that knows better than the tab it is on says so around its
 *     `emit("play-episode", …)`: `withPlaySurface("queue", () => emit(…))`.
 *     The bus is synchronous and the layout's handler takes its token before
 *     its first await, so the surface is bound to exactly that start
 *     (`bindPlaySurface`, called next to `beginStart()`).
 *   - `primeEpisode()` binds `restore` to the remembered show's start, so its
 *     first ▶ (togglePlay, the second start path) reports `restore`.
 *   - The live station is recognised where the listen is counted (the airing
 *     claim in `countListen`), whoever started it.
 *   - Anything else is the tab the listener was on (`routeOf`).
 *
 * No React, no store: called on the play path, synchronously.
 */

import { routeOf, type PlaySurface } from "@/lib/usage/vocab";
import { currentStart } from "./play-session";

let pending: PlaySurface | null = null;
let bound: { start: number; surface: PlaySurface } | null = null;

/** Run `fn` (an emit of play-episode) with `surface` as the start's surface. */
export function withPlaySurface<T>(surface: PlaySurface, fn: () => T): T {
  const prev = pending;
  pending = surface;
  try {
    return fn();
  } finally {
    pending = prev;
  }
}

/**
 * Start `start` was taken: give it `surface`, or whatever a caller declared
 * around the emit that led here, or nothing (the tab decides at count time).
 */
export function bindPlaySurface(start: number, surface: PlaySurface | null = pending): void {
  bound = surface ? { start, surface } : null;
}

/**
 * The surface of start `start`, decided when its listen is counted. `live` is
 * the caller's to say: it is the one that knows the start is the station's.
 */
export function playSurfaceFor(
  start: number,
  live: boolean,
  pathname = typeof location !== "undefined" ? location.pathname : "",
): PlaySurface {
  if (live) return "live";
  if (bound && bound.start === start) return bound.surface;
  // The tab, as a surface. The welcome page and the admin tabs start nothing
  // of their own: "other".
  const route = routeOf(pathname);
  return route === "welcome" ? "other" : route;
}

/**
 * Run `fn` (a Try Again's emit) as the same surface as the start it retries:
 * a retry is the listen the listener already asked for, from wherever they
 * asked. With nothing bound to that start, the tab decides as usual.
 */
export function retryWithPlaySurface<T>(fn: () => T): T {
  const s = bound && bound.start === currentStart() ? bound.surface : null;
  return s ? withPlaySurface(s, fn) : fn();
}

export function resetPlaySurfaceForTests(): void {
  pending = null;
  bound = null;
}
