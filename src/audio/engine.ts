/**
 * Audio Engine
 *
 * Audio plays natively through HTMLAudioElement — this survives iOS lock
 * screen, background tabs, and AudioContext suspension.
 *
 * On desktop and Android the element is routed through Web Audio by
 * src/audio/processing.ts, for Level and Clean up and for the visualizers'
 * analyser: element → worklet → analyser → volume → speakers. That module
 * owns the AudioContext; this one asks it for the analyser and hands it the
 * volume. createMediaElementSource() can only be called once per element, so
 * the graph is never torn down. On iOS nothing is routed (see levels.ts).
 */

import { processingAnalyser, resumeProcessing, setProcessingVolume } from "@/audio/processing";

let mediaElement: HTMLAudioElement | null = null;
/**
 * A seek requested before the element knew its own timeline (readyState 0).
 * Applied on `loadedmetadata`. See seekEngine().
 */
let pendingSeek: number | null = null;

/**
 * The analyser the visualizers read (desktop and Android), or null until the
 * element is routed. Asking is what routes it when neither switch is on: the
 * graph waits for a running context (a tap), never one created suspended in
 * an animation frame, which is what left the meters flat on Safari.
 */
export function getAnalyserNode(): AnalyserNode | null {
  if (!mediaElement?.src) return null;
  return processingAnalyser();
}

export function getMediaElement(): HTMLAudioElement | null {
  return mediaElement;
}

export function initEngine(audio: HTMLAudioElement): void {
  if (mediaElement === audio) return;

  const previous = mediaElement;
  mediaElement = audio;
  for (const [type, fns] of engineListeners) {
    for (const fn of fns) {
      previous?.removeEventListener(type, fn);
      audio.addEventListener(type, fn);
    }
  }
  pendingSeek = null;
  audio.addEventListener("loadedmetadata", () => {
    if (mediaElement !== audio || pendingSeek === null) return;
    const t = pendingSeek;
    pendingSeek = null;
    audio.currentTime = clampToDuration(audio, t);
  });
  // The station ID is over and the next show is not due: quiet, looped, on
  // the same element, so it never stops playing (see playBridge).
  audio.addEventListener("ended", () => {
    if (mediaElement !== audio || !bridging || audio.loop) return;
    // A station break's spot is over: the station ID, then quiet.
    const next = bridgeQueue.shift();
    if (next) {
      audio.src = next;
      fromTheTop(audio);
      audio.play().catch(() => {});
      return;
    }
    audio.loop = true;
    audio.src = BRIDGE_QUIET_URL;
    fromTheTop(audio);
    audio.play().catch(() => {});
  });
}

/** The listener's volume: on the graph once routed (after the processing), else on the element. */
export function setEngineVolume(volume: number): void {
  if (setProcessingVolume(volume)) return;
  if (mediaElement) mediaElement.volume = volume;
}

// ── The one way to touch the element from outside the player hook ──
//
// The player is a detached `new Audio()` — it is never in the DOM. Code that
// reached for it with `document.querySelector("audio")` got `null` in
// production and did nothing, silently: the sleep timer faded the show out,
// "paused" it in the store only, and put the volume back while the broadcast
// kept playing all night (HD-001); bookmark markers never moved the playhead
// (HD-012). The tests that should have caught both put an <audio> into the
// DOM, which production never has. ESLint now bans the lookup
// (eslint.config.mjs); these are what to use instead.

/** Pause the player's element. No-op when there is none. */
export function pauseEngine(): void {
  mediaElement?.pause();
}

// ── The live station's bridge between shows ──
//
// At 04:34:25 on 2026-09-27 the station moved to its next show and phones
// with the tab in the background refused it (`play-rejected`). Between shows
// the station used to pause this element and play its static through Web
// Audio. A paused element lets iOS end the page's audio session, and a
// backgrounded page may not start a new one: the next show's play() was
// refused, and the screen was off, so nobody was there to tap.
//
// So the element never stops. At a slot's end it is handed the station ID (a
// file, on this origin), then quiet on a loop until the next show, and the
// next show's source is assigned over it in the same task as its play(). The
// audio session stays alive from one show to the next.
//
// While bridging, the element's events are not the show's: its `ended` is not
// the show ending, its duration is not the show's, its position is nobody's.
// isBridging() is how the player's listeners and the position tick know.

/** The station ID: 8 s of static and a tone (STATION_ID_SEC). */
export const STATION_ID_URL = "/audio/station-id.mp3";
/** Silence, looped, for whatever is left of the gap after the ID. */
export const BRIDGE_QUIET_URL = "/audio/station-quiet.mp3";

let bridging = false;
/** What the bridge plays after the current source, before quiet (a break's station ID). */
let bridgeQueue: string[] = [];

/**
 * A new bridge source starts at 0, said out loud. A `currentTime` written
 * before metadata (seekEngine priming a restored show at its saved position)
 * becomes the element's default start position, and Chromium keeps it across
 * a change of `src`: after a reload, the station ID started at 94 s, was
 * clamped to its own 8 s end, ended at once, and the gap was taken for a
 * pause, so the next show never started. Found by e2e/stale-tab.spec.ts.
 */
function fromTheTop(a: HTMLMediaElement): void {
  pendingSeek = null;
  try {
    a.currentTime = 0;
  } catch {
    // An engine that refuses a write before metadata keeps no position either.
  }
}

export function isBridging(): boolean {
  return bridging;
}

/**
 * Play the station ID on the player's element, straight over whatever it is
 * playing: no pause, no teardown. Rejects as play() does (NotAllowedError when
 * the browser refuses), for the station to handle.
 *
 * With `spotUrl` (a station break, src/lib/live/breaks.ts), the spot plays
 * first and the station ID after it, on the same element, then quiet.
 */
export function playBridge(spotUrl?: string): Promise<void> {
  const a = mediaElement;
  if (!a) return Promise.resolve();
  bridging = true;
  pendingSeek = null;
  a.loop = false;
  bridgeQueue = spotUrl ? [STATION_ID_URL] : [];
  a.src = spotUrl ?? STATION_ID_URL;
  fromTheTop(a);
  a.playbackRate = 1;
  return a.play();
}

/**
 * The next show is taking the element: stop treating its events as the
 * bridge's. Does not pause — the show's own source is assigned next.
 */
export function endBridge(): void {
  if (!bridging) return;
  bridging = false;
  bridgeQueue = [];
  if (mediaElement) mediaElement.loop = false;
}

/** Leaving the station mid-bridge: silence it, and let go of the source. */
export function stopBridge(): void {
  if (!bridging) return;
  bridging = false;
  bridgeQueue = [];
  const a = mediaElement;
  if (!a) return;
  a.loop = false;
  a.pause();
  a.removeAttribute("src");
  a.load();
}

function clampToDuration(audio: HTMLAudioElement, t: number): number {
  const d = audio.duration;
  const upper = Number.isFinite(d) && d > 0 ? d : Infinity;
  return Math.max(0, Math.min(t, upper));
}

/**
 * Move the playhead to `t` seconds, and return where it will be.
 *
 * At readyState 0 (HAVE_NOTHING) — a restored episode that has a `src` but has
 * not loaded, or any element in the instant after its source is assigned — the
 * element has no timeline yet: `duration` is NaN, and browsers disagree about
 * what an early `currentTime` write does. So the seek is also held and applied
 * on `loadedmetadata`, which every engine fires before playback can start.
 * Scrubbing a not-yet-loaded show used to do nothing at all (HD-024).
 */
export function seekEngine(t: number): number {
  const audio = mediaElement;
  if (!audio || !Number.isFinite(t)) return 0;
  if (audio.readyState === 0) {
    pendingSeek = Math.max(0, t);
    try {
      audio.currentTime = pendingSeek;
    } catch {
      // Some engines refuse a write before metadata; loadedmetadata applies it.
    }
    return pendingSeek;
  }
  pendingSeek = null;
  audio.currentTime = clampToDuration(audio, t);
  return audio.currentTime;
}

/**
 * What the element is doing, read-only. For the live station, which has to
 * compare where the listener is with where the station is (drift) without
 * reaching for the element itself. Null before there is an element.
 */
export interface EngineState {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  hasError: boolean;
  /** The URL the element was given (currentSrc): a redirect it followed does not change it. */
  src: string;
  /** Seconds; NaN before metadata. */
  duration: number;
}

export function engineState(): EngineState | null {
  const a = mediaElement;
  if (!a) return null;
  return {
    currentTime: a.currentTime,
    paused: a.paused,
    ended: a.ended,
    readyState: a.readyState,
    hasError: a.error != null,
    src: a.currentSrc || a.src,
    duration: a.duration,
  };
}

type EngineEvent = "waiting" | "playing" | "seeked" | "pause" | "play" | "seeking" | "loadstart";
const engineListeners = new Map<EngineEvent, Set<() => void>>();

/**
 * Listen for one of the element's events. Survives the element being created
 * after the call (it is made lazily by the player hook). Returns the unsubscribe.
 */
export function onEngineEvent(type: EngineEvent, fn: () => void): () => void {
  let fns = engineListeners.get(type);
  if (!fns) engineListeners.set(type, (fns = new Set()));
  fns.add(fn);
  mediaElement?.addEventListener(type, fn);
  return () => {
    fns!.delete(fn);
    mediaElement?.removeEventListener(type, fn);
  };
}

/**
 * Resume the processing AudioContext, if there is one and it needs it.
 * Not required for audio playback while nothing is routed.
 */
export function resumeContext(): Promise<void> {
  return resumeProcessing();
}
