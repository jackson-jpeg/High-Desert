/**
 * Audio levels for the visualizers: the one place every one of them reads.
 *
 *   - Desktop and Android: the engine's AnalyserNode, the player's element
 *     routed through an AudioContext (engine.ts), exactly as before.
 *   - iOS: the level tap (src/audio/level-tap/tap.ts). The element is never
 *     routed through Web Audio there, because that stops a show on the lock
 *     screen; the tap decodes the same bytes off to the side instead.
 *
 * Both answer the same calls (`LevelSource`), so a visualizer, the Win98
 * Winamp window's included, never knows which it has. Mount a visualizer with
 * `retainLevels()` and read `getLevelSource()` once per frame; null means
 * "nothing to show" (no element, the live station's bridge, a local file on
 * iOS), and the visualizer draws its idle frame.
 */
import { engineState, getAnalyserNode, isBridging, onEngineEvent } from "@/audio/engine";
import { LevelTap, type Decoded } from "@/audio/level-tap/tap";
import { isIOSDevice } from "@/lib/utils/platform";

/** The part of AnalyserNode the visualizers use. */
export interface LevelSource {
  readonly fftSize: number;
  readonly frequencyBinCount: number;
  getByteTimeDomainData(out: Uint8Array<ArrayBuffer>): void;
  getByteFrequencyData(out: Uint8Array<ArrayBuffer>): void;
  getFloatTimeDomainData(out: Float32Array<ArrayBuffer>): void;
}

/** The rate chunks are decoded at: an AnalyserNode's usual, so bins mean what they do on desktop. */
const DECODE_RATE = 44_100;

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

let offline: OfflineAudioContext | null = null;

/**
 * Decode a chunk of MPEG frames to mono PCM. An OfflineAudioContext renders
 * to no device: it opens no audio session and cannot take the lock screen's
 * controls from the element. The callback form, because older Safari's
 * decodeAudioData returns no promise.
 */
function decode(bytes: ArrayBuffer): Promise<Decoded> {
  if (!offline) {
    const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
    const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (!Ctor) return Promise.reject(new Error("no OfflineAudioContext"));
    offline = new Ctor(1, 1, DECODE_RATE);
  }
  const ctx = offline;
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.catch === "function") p.catch(reject);
  }).then((buf) => {
    const data = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) data[i] += ch[i] / buf.numberOfChannels;
    }
    return { sampleRate: buf.sampleRate, data };
  });
}

let tap: LevelTap | null = null;

function theTap(): LevelTap {
  if (tap) return tap;
  const t = new LevelTap({
    player: () => {
      const s = engineState();
      return s ? { src: s.src, t: s.currentTime, duration: s.duration, paused: s.paused, readyState: s.readyState } : null;
    },
    bridging: isBridging,
    visible: () => document.visibilityState === "visible",
    fetch: (url, init) => fetch(url, { ...init, mode: "cors", credentials: "omit" }),
    decode,
    origin: window.location.origin,
    now: () => Date.now(),
  });
  // Off the network the moment the screen locks or the show pauses; the next
  // drawn frame starts it again where the playhead is.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") t.halt();
  });
  onEngineEvent("pause", () => t.halt());
  tap = t;
  return t;
}

/** Whether this device reads the level tap rather than the engine's analyser. */
export function usesLevelTap(): boolean {
  return isIOSDevice();
}

/** The levels of what is playing now, or null when there is nothing to show. Call once per frame. */
export function getLevelSource(): LevelSource | null {
  if (!usesLevelTap()) return getAnalyserNode() as LevelSource | null;
  const t = theTap();
  return t.active() ? t : null;
}

/** A visualizer is on screen: the tap may use the network. Returns the release. */
export function retainLevels(): () => void {
  if (!usesLevelTap() || typeof window === "undefined") return () => {};
  return theTap().retain();
}
