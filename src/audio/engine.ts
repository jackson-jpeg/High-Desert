/**
 * Audio Engine
 *
 * Audio plays natively through HTMLAudioElement — this survives iOS lock
 * screen, background tabs, and AudioContext suspension.
 *
 * For the oscilloscope visualization, we create an AudioContext and route
 * the media element through createMediaElementSource(). This gives us
 * real waveform data via an AnalyserNode. The audio is connected:
 *   mediaElement → source → analyser → destination
 * so playback continues normally through speakers.
 *
 * createMediaElementSource() can only be called ONCE per element, so we
 * guard with `elementConnected` and never tear down the graph.
 */

import { isIOSDevice } from "@/lib/utils/platform";

let mediaElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let elementConnected = false;
/** Set once analyser setup has failed, so the frame loop stops retrying forever. */
let analyserInitFailed = false;
/**
 * A seek requested before the element knew its own timeline (readyState 0).
 * Applied on `loadedmetadata`. See seekEngine().
 */
let pendingSeek: number | null = null;

export function getAnalyserNode(): AnalyserNode | null {
  // Lazy init: try when we don't have an analyser and audio is playing
  if (!analyserNode && mediaElement?.src && !mediaElement.paused) {
    tryInitAnalyser();
  }
  return analyserNode;
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
  // Reset connection flag only if we get a brand new element
  if (!elementConnected) {
    analyserNode = null;
    audioContext = null;
  }
}

export function setEngineVolume(volume: number): void {
  if (mediaElement) {
    mediaElement.volume = volume;
  }
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
  };
}

type EngineEvent = "waiting" | "playing" | "seeked";
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
 * Resume the analyser AudioContext (for oscilloscope).
 * Not required for audio playback — the element plays natively.
 */
export function resumeContext(): Promise<void> {
  if (audioContext?.state === "suspended") {
    return audioContext.resume();
  }
  return Promise.resolve();
}

/**
 * Try to create an AnalyserNode for oscilloscope visualization.
 * Uses createMediaElementSource() to route audio through Web Audio API.
 * Can only be called once per media element.
 */
function tryInitAnalyser(): void {
  if (analyserNode || !mediaElement || elementConnected || analyserInitFailed) return;
  // Never route through AudioContext on iOS — it kills background playback
  if (isIOSDevice()) return;

  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(mediaElement);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    source.connect(analyserNode);
    analyserNode.connect(audioContext.destination); // MUST connect or no audio!
    elementConnected = true;

    // Resume in case created outside a user gesture
    if (audioContext.state === "suspended") {
      audioContext.resume().catch((err) => { console.warn("[engine] Failed to resume AudioContext:", err); });
    }
  } catch {
    // createMediaElementSource not supported or CORS issue — that's fine,
    // oscilloscope shows the idle breathing animation.
    // Latch the failure: this is called from the animation frame loop, so without
    // it we would construct a new AudioContext ~60x/sec until the browser's
    // per-document limit is hit and the tab degrades.
    analyserNode = null;
    analyserInitFailed = true;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
  }
}

// cleanupAnalyser removed — createMediaElementSource graph is permanently bound
