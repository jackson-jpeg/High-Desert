/**
 * Watches a load attempt and gives up on the listener's behalf.
 *
 * A user reported that shows "sometimes don't start" and assumed it was their
 * fault. The direct cause was elsewhere (the restore path never assigned
 * `audio.src`), but the reason it read as *their* mistake was this: nothing in
 * the app had an opinion about how long a load may take. The element fires
 * `waiting` and then, if the connection simply hangs, nothing at all — no
 * `error`, no timeout — until the browser's own limit, which on a large file
 * over a weak mobile connection is longer than anyone will wait. The UI showed
 * a static ▶ throughout.
 *
 * So: a clock. Twelve seconds from source assignment to `canplay`, or eight
 * seconds stuck in `waiting`, buys one silent retry. If the retry also fails
 * the state machine lands on `failed`, which is what raises the modal. A
 * failure the listener can see is a much smaller problem than one they can't.
 *
 * Module-level rather than per-hook, because there is exactly one media element
 * (see `src/audio/engine.ts`) and useAudioPlayer is instantiated more than once.
 */

import { reportPlaybackFailure } from "@/services/stats/client";
import { uaClass } from "@/lib/utils/platform";

/**
 * How long we will wait with no evidence of life at all.
 *
 * Deliberately *not* "time from tap to canplay". A 70MB show on a weak mobile
 * connection can legitimately take longer than this to become playable, and
 * retrying there would throw away everything already buffered and make a slow
 * load into a broken one. The same mistake was made once in the service
 * worker's navigation handler, where a timeout served stale HTML to people who
 * were merely on a slow connection; the fix there was to delete the timeout.
 *
 * So the deadline resets whenever bytes arrive (see noteProgress). What it
 * catches is the case with no recovery path: a connection that opened and then
 * went silent, which fires no `error` and would otherwise hang until the
 * browser's own limit — long past when anyone stops waiting.
 */
const LOAD_TIMEOUT_MS = 12_000;
/** How long the element may sit in `waiting` before we call it a stall. */
const STALL_TIMEOUT_MS = 8_000;

export type FailureKind =
  | "timeout"
  | "stall"
  | "play-rejected"
  | "network-error"
  | "decode-error";

interface Attempt {
  audio: HTMLAudioElement;
  /** The original URL, without any cache-buster we may have added. */
  url: string;
  /** Community key for telemetry, or null for local files we don't track. */
  episodeId: string | null;
  /** Where playback should resume from, in seconds. */
  startAt: number;
  startedAt: number;
  retried: boolean;
  /** Set once the attempt has resolved, so late events are ignored. */
  settled: boolean;
}

let current: Attempt | null = null;
let loadTimer = 0;
let stallTimer = 0;

/** Called with the terminal failure kind once the retry is also spent. */
type FailHandler = (kind: FailureKind) => void;
let onFail: FailHandler = () => {};

export function setFailureHandler(handler: FailHandler): void {
  onFail = handler;
}

function clearTimers() {
  window.clearTimeout(loadTimer);
  window.clearTimeout(stallTimer);
  loadTimer = 0;
  stallTimer = 0;
}

/**
 * (Re)start the no-progress deadline. Called on arm, on retry, and every time
 * bytes arrive — so a download that is merely slow is never interrupted.
 */
function resetLoadDeadline(attempt: Attempt) {
  window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => {
    if (attempt.settled) return;
    if (!attempt.retried) retry("timeout", attempt);
    else giveUp("timeout", attempt);
  }, LOAD_TIMEOUT_MS);
}

/**
 * Appends a cache-buster without assuming the URL has no query string. The
 * seed catalog's archive.org URLs never do, but a locally imported episode's
 * might, and `?a=1?b=2` is not a URL.
 */
function withCacheBuster(url: string, attempt: number): string {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("hd_retry", String(attempt));
    return u.toString();
  } catch {
    return url + (url.includes("?") ? "&" : "?") + `hd_retry=${attempt}`;
  }
}

function report(kind: FailureKind, attempt: Attempt, recovered: boolean) {
  if (!attempt.episodeId) return;
  reportPlaybackFailure({
    episodeId: attempt.episodeId,
    kind,
    retried: attempt.retried,
    recovered,
    elapsedMs: Math.round(performance.now() - attempt.startedAt),
    uaClass: uaClass(),
  });
}

/**
 * Reset the element properly before re-assigning a source.
 *
 * `src = ""` looks equivalent but is not: an empty string resolves against the
 * document URL, so the browser dutifully fetches the HTML page and tries to
 * decode it as audio, firing a spurious `error` on the way.
 */
function resetElement(audio: HTMLAudioElement) {
  audio.removeAttribute("src");
  audio.load();
}

function giveUp(kind: FailureKind, attempt: Attempt) {
  attempt.settled = true;
  clearTimers();
  current = null;
  report(kind, attempt, false);
  onFail(kind);
}

function retry(kind: FailureKind, attempt: Attempt) {
  attempt.retried = true;
  clearTimers();

  const { audio } = attempt;
  resetElement(audio);
  audio.src = withCacheBuster(attempt.url, 1);
  audio.currentTime = attempt.startAt;

  // The retry is silent by design — the listener is already waiting and being
  // told "retrying" mid-wait only makes the wait feel longer. They find out
  // only if this one fails too.
  attempt.startedAt = performance.now();
  resetLoadDeadline(attempt);

  audio.play().catch(() => {
    if (!attempt.settled) giveUp("play-rejected", attempt);
  });
}

/** A load attempt has begun. Starts the clock. */
export function armWatchdog(opts: {
  audio: HTMLAudioElement;
  url: string;
  episodeId: string | null;
  startAt: number;
}): void {
  clearTimers();

  const attempt: Attempt = {
    ...opts,
    startedAt: performance.now(),
    retried: false,
    settled: false,
  };
  current = attempt;

  resetLoadDeadline(attempt);
}

/** The element has enough data to start. Cancels the clock. */
export function noteReady(): void {
  if (current) {
    // A retry that worked is still worth knowing about: it means this episode
    // is slow or flaky even though the listener never saw a problem.
    if (current.retried) report("timeout", current, true);
    current.settled = true;
  }
  clearTimers();
  current = null;
}

/** The element is waiting for data mid-load. Starts the stall clock. */
export function noteWaiting(): void {
  const attempt = current;
  if (!attempt || attempt.settled || stallTimer) return;

  stallTimer = window.setTimeout(() => {
    if (attempt.settled) return;
    if (!attempt.retried) retry("stall", attempt);
    else giveUp("stall", attempt);
  }, STALL_TIMEOUT_MS);
}

/**
 * Bytes arrived. Whatever we were calling a stall, isn't one — and the
 * no-progress deadline starts again from here, so a slow download is left
 * alone for as long as it keeps moving.
 */
export function noteProgress(): void {
  window.clearTimeout(stallTimer);
  stallTimer = 0;
  if (current && !current.settled) resetLoadDeadline(current);
}

/**
 * The element reported a hard error. Unlike a timeout this is definitive, so
 * it consumes the retry immediately rather than waiting out the clock.
 */
export function noteError(kind: FailureKind): void {
  const attempt = current;
  if (!attempt || attempt.settled) return;
  if (!attempt.retried) retry(kind, attempt);
  else giveUp(kind, attempt);
}

/** Whether a load attempt is outstanding — used to decide if an error is ours. */
export function isWatching(): boolean {
  return current !== null && !current.settled;
}

/** Abandon the current attempt without reporting (user changed their mind). */
export function disarmWatchdog(): void {
  if (current) current.settled = true;
  clearTimers();
  current = null;
}

export const __testing = {
  LOAD_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  withCacheBuster,
  resetElement,
};
