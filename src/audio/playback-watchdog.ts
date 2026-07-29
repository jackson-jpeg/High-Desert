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
  | "decode-error"
  /** The file loaded fine and contains no usable broadcast. Never retried. */
  | "empty-media"
  /**
   * `loadedmetadata` reported a duration under the floor. Advisory only: it is
   * recorded and playback is *not* stopped. For a VBR rip with no Xing header —
   * most of this catalog — the duration at that point is extrapolated from the
   * first frame, and an extrapolation should not get stopping power over an
   * episode that plays fine. `ended` keeps sole authority to fail a show.
   *
   * These rows exist to answer, from real traffic, how many working episodes the
   * five-second floor would have eaten if it had been authoritative.
   */
  | "empty-media-suspected";

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
  /**
   * Whatever the element told us about *why*, carried to the eventual report.
   *
   * `MediaError.code` plus its message, when the browser supplies one. Chromium
   * writes a real diagnostic there ("DEMUXER_ERROR_COULD_NOT_OPEN: …"), which is
   * the only way an empty file is distinguishable from an unreachable one on
   * that engine — it errors on the missing MPEG frames rather than reporting a
   * short duration, so `empty-media-suspected` can never fire there.
   */
  detail: string | null;
}

let current: Attempt | null = null;
let loadTimer = 0;
let stallTimer = 0;

// ── Is anything actually feeding this thing? ──
//
// Every input this module has — noteProgress, noteReady, noteWaiting, noteError
// — arrives from a media element listener installed by useAudioPlayer. For four
// months those listeners were never attached (a ref-counting bug shared one
// counter across five install sites), and nothing here noticed. The watchdog
// armed, saw no `progress` because nothing was listening for it, ran its
// deadline out, tore down an element that was playing perfectly well, and
// reported a timeout. Every row in `playback_failures` was written that way.
//
// The failure mode is specific and worth naming: a detector with no inputs
// cannot distinguish "nothing happened" from "I cannot see". It failed open and
// invented telemetry. So it now requires positive evidence that it is wired,
// and fails closed without it — no timer, no teardown, no report.
let listenerRefs = 0;

/** The media element listeners are installed. Called from their install. */
export function noteListenersAttached(): void {
  listenerRefs++;
}

/** ...and from their cleanup. */
export function noteListenersDetached(): void {
  listenerRefs = Math.max(0, listenerRefs - 1);
}

function wired(): boolean {
  return listenerRefs > 0;
}

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

/** readyState at which the element has a current frame to render/play. */
const HAVE_CURRENT_DATA = 2;

/**
 * Is the show, right now, audibly playing?
 *
 * The floor under everything else here. A watchdog exists to catch silence, and
 * the one thing it must never do is interrupt sound — which is precisely what it
 * spent four months doing: twelve seconds into a broadcast that was streaming
 * perfectly, it tore the element down and re-assigned `src`, so the show cut out
 * and restarted from the beginning (or, on iOS, stopped for good).
 *
 * `paused` alone is not enough: `play()` clears it synchronously, so a load that
 * has stalled with nothing buffered also reports `paused === false`. The
 * readyState half is what makes this mean "there is audio coming out".
 */
function isAudiblyPlaying(attempt: Attempt): boolean {
  const { audio } = attempt;
  return (
    audio.paused === false &&
    typeof audio.readyState === "number" &&
    audio.readyState >= HAVE_CURRENT_DATA
  );
}

/**
 * If the show is playing, the deadline was wrong — stand down instead of firing.
 *
 * Belt and braces with noteProgress(): that is the designed signal and this is
 * the check that does not depend on any signal arriving at all.
 */
function standDownIfPlaying(attempt: Attempt): boolean {
  if (!isAudiblyPlaying(attempt)) return false;
  if (attempt.retried) report("timeout", attempt, true);
  attempt.settled = true;
  clearTimers();
  if (current === attempt) current = null;
  return true;
}

/**
 * (Re)start the no-progress deadline. Called on arm, on retry, and every time
 * bytes arrive — so a download that is merely slow is never interrupted.
 */
function resetLoadDeadline(attempt: Attempt) {
  window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => {
    if (attempt.settled) return;
    if (standDownIfPlaying(attempt)) return;
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
  // Second gate. armWatchdog already refuses to arm unwired, so reaching here
  // unwired should be impossible — which is exactly why it is worth asserting
  // rather than assuming.
  if (!wired()) return;
  reportPlaybackFailure({
    episodeId: attempt.episodeId,
    kind,
    retried: attempt.retried,
    recovered,
    elapsedMs: Math.round(performance.now() - attempt.startedAt),
    uaClass: uaClass(),
    ...(attempt.detail ? { detail: attempt.detail } : {}),
  });
}

/**
 * Is there transient user activation right now — may we call `play()`?
 *
 * The silent retry runs from a `setTimeout`, twelve seconds after the tap that
 * started the load, so by then the activation that authorised the original
 * `play()` has almost always expired. Calling anyway does not fail politely: the
 * element has already been torn down and re-sourced by that point, so a refusal
 * leaves the listener with no audio, no buffer and — before the failure handler
 * was wired up — nothing on screen either. A `play()` that cannot succeed should
 * not be attempted; the dialog's *Try Again* button is a real gesture and can.
 *
 * Not an iOS special case. Safari refuses loudest, but the rule is the same
 * everywhere and the honest dialog is better than a silent teardown on all of
 * them.
 *
 * Unsupported (Safari below 16.4, Firefox below 121) is treated as *permitted*.
 * We cannot tell, and guessing "no" would disable the retry on browsers where it
 * may well work; guessing "yes" costs at worst a rejected `play()`, which is now
 * terminal and raises the same dialog a few seconds later.
 */
function hasUserActivation(): boolean {
  const ua = (
    navigator as Navigator & { userActivation?: { isActive?: unknown } }
  ).userActivation;
  if (!ua || typeof ua.isActive !== "boolean") return true;
  return ua.isActive;
}

/** Trim a browser diagnostic to something a text column can hold. */
function shortDetail(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, 200);
}

/**
 * What the element said went wrong, as one short string.
 *
 * `MediaError.code` is always present; `message` is Chromium-only in practice
 * and is a pipeline diagnostic, not anything the listener typed or that
 * identifies them.
 */
export function describeMediaError(err: MediaError | null | undefined): string | null {
  if (!err) return null;
  const msg = shortDetail(typeof err.message === "string" ? err.message : null);
  return shortDetail(`code=${err.code}${msg ? ` ${msg}` : ""}`);
}

/**
 * `loadedmetadata` claimed a duration below the playable floor.
 *
 * Advisory: recorded, never acted on. Separate from the Attempt lifecycle
 * because it is not a failure and must not settle, retry or fail anything — it
 * can also arrive long after a load has settled. `retried`/`recovered` are
 * pinned false so it can never be mistaken for a real failure, and `detail`
 * carries the duration the element reported so the floor can be judged later.
 */
export function noteSuspectDuration(
  episodeId: string | null,
  reportedDuration: number,
): void {
  if (!episodeId || !wired()) return;
  reportPlaybackFailure({
    episodeId,
    kind: "empty-media-suspected",
    retried: false,
    recovered: false,
    elapsedMs: 0,
    uaClass: uaClass(),
    detail: `duration=${Number.isFinite(reportedDuration) ? reportedDuration.toFixed(3) : String(reportedDuration)}`,
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
  const { audio } = attempt;
  // Whether the listener had asked for sound before we reset the element. A
  // primed-but-unplayed element, or one they paused mid-load, must not be
  // started by a timer on their behalf.
  const wanted = audio.paused === false;

  // A retry that will need `play()` and cannot have it is not a retry — it is a
  // teardown followed by silence. Skip it entirely, keeping whatever the element
  // still holds, and raise the dialog: its *Try Again* runs inside a real
  // gesture and is the only thing that can actually succeed from here.
  // `retried` stays false, so these rows are distinguishable in the telemetry
  // from failures where the retry ran and did not help.
  if (wanted && !hasUserActivation()) {
    giveUp(kind, attempt);
    return;
  }

  attempt.retried = true;
  clearTimers();

  resetElement(audio);
  audio.src = withCacheBuster(attempt.url, 1);
  audio.currentTime = attempt.startAt;

  // The retry is silent by design — the listener is already waiting and being
  // told "retrying" mid-wait only makes the wait feel longer. They find out
  // only if this one fails too.
  attempt.startedAt = performance.now();
  resetLoadDeadline(attempt);

  if (!wanted) return;

  audio.play().catch(() => {
    if (attempt.settled) return;
    // This runs inside a timer callback, so on iOS the call sits outside the
    // user-activation chain and Safari refuses it outright — no amount of
    // retrying gets it back, the listener has to tap again. Terminal, then, and
    // it now raises the dialog that says so. It used to stop the audio dead
    // twelve seconds in and show nothing at all, because the failure handler
    // this routes through was never installed.
    giveUp("play-rejected", attempt);
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

  // Fail closed. Without the media listeners this cannot see `progress` or
  // `canplay`, so every attempt would run its deadline out and be reported as a
  // timeout regardless of what the network actually did — and the retry would
  // tear down a working stream on the way. Better to supervise nothing and say
  // so than to supervise blind.
  if (!wired()) {
    console.error(
      "[watchdog] refusing to arm: media element listeners are not attached. " +
        "Playback is unsupervised — no timeout, no retry, no failure dialog.",
    );
    current = null;
    return;
  }

  const attempt: Attempt = {
    ...opts,
    startedAt: performance.now(),
    retried: false,
    settled: false,
    detail: null,
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
    if (standDownIfPlaying(attempt)) return;
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
export function noteError(kind: FailureKind, detail?: string | null): void {
  const attempt = current;
  if (!attempt || attempt.settled) return;
  // Kept even if the retry rescues it and the eventual report is a recovery —
  // "what did it say the first time" is the useful half of a flaky episode.
  attempt.detail = shortDetail(detail) ?? attempt.detail;
  if (!attempt.retried) retry(kind, attempt);
  else giveUp(kind, attempt);
}

/**
 * The transfer worked and what arrived is not playable.
 *
 * Distinct from noteError because the retry is not just useless here, it is
 * harmful: a second request returns the same bytes, so all it buys is another
 * twelve seconds of the listener waiting on a file that was never going to
 * play. Fail immediately and say so.
 */
export function noteUnplayable(kind: FailureKind, detail?: string | null): void {
  const attempt = current;
  if (!attempt || attempt.settled) return;
  attempt.detail = shortDetail(detail) ?? attempt.detail;
  giveUp(kind, attempt);
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
  hasUserActivation,
  shortDetail,
  /** Drop the wiring count back to zero between tests. */
  resetListeners: () => {
    listenerRefs = 0;
  },
};
