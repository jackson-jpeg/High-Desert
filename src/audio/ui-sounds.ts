/**
 * Interface sounds (docs/UI-PLAN.md, push 5): a click, a soft relay tick on
 * hover, the Start menu opening, the dial's tune blip. Synthesised here with
 * Web Audio, no files.
 *
 * Off unless the listener turns them on (Start > Settings > Sounds in Win98,
 * More > Sounds on a phone), stored per browser in localStorage. Even when on:
 * - nothing before the page has had a tap or a key (`userActivation`);
 * - nothing while the tab is hidden;
 * - never on iOS: the player there is never routed through Web Audio (it
 *   stops the show on the lock screen, CLAUDE.md "Meters and visualizers"),
 *   and a second AudioContext would claim the same audio session.
 * Its own AudioContext, never the engine's: these sounds never pass through
 * the player's chain (Level, the analyser) and never touch MediaSession.
 */

import { isIOSDevice } from "@/lib/utils/platform";

export type UiSound = "click" | "hover" | "open" | "tune";

export const UI_SOUNDS_KEY = "hd-ui-sounds";
export const UI_SOUNDS_EVENT = "hd-ui-sounds-change";

/** Whether the listener has turned the sounds on (off by default). */
export function uiSoundsOn(): boolean {
  try {
    return localStorage.getItem(UI_SOUNDS_KEY) === "on";
  } catch {
    return false;
  }
}

export function setUiSounds(on: boolean): void {
  try {
    if (on) localStorage.setItem(UI_SOUNDS_KEY, "on");
    else localStorage.removeItem(UI_SOUNDS_KEY);
  } catch {
    // Storage refused (private mode): the switch simply does not stick.
  }
  window.dispatchEvent(new Event(UI_SOUNDS_EVENT));
}

/** Whether the sounds can be offered at all on this device. */
export function uiSoundsSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (isIOSDevice()) return false;
  return typeof window.AudioContext === "function";
}

/** Every reason a sound must not play now; empty means it may. */
export function uiSoundBlocked(): string | null {
  if (!uiSoundsSupported()) return "unsupported";
  if (!uiSoundsOn()) return "off";
  if (document.visibilityState === "hidden") return "hidden";
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return "no-gesture";
  return null;
}

let ctx: AudioContext | null = null;

/** Each sound as a recipe: an oscillator or noise, a pitch, a length, a level. */
export const RECIPES: Record<UiSound, { wave: OscillatorType | "noise"; from: number; to: number; ms: number; gain: number }> = {
  // The Win98 click: a very short band of noise.
  click: { wave: "noise", from: 2400, to: 2400, ms: 14, gain: 0.18 },
  // A relay tick on hover: quieter and shorter than the click.
  hover: { wave: "square", from: 1800, to: 1800, ms: 6, gain: 0.03 },
  // The Start menu: a two-step rise.
  open: { wave: "triangle", from: 520, to: 880, ms: 70, gain: 0.08 },
  // The dial's tune blip.
  tune: { wave: "sine", from: 660, to: 990, ms: 45, gain: 0.08 },
};

export function playUiSound(kind: UiSound): boolean {
  if (uiSoundBlocked()) return false;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const r = RECIPES[kind];
    const t = ctx.currentTime;
    const end = t + r.ms / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(r.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(ctx.destination);
    if (r.wave === "noise") {
      const len = Math.max(1, Math.ceil((ctx.sampleRate * r.ms) / 1000));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = r.from;
      src.connect(band).connect(g);
      src.start(t);
      src.stop(end);
    } else {
      const osc = ctx.createOscillator();
      osc.type = r.wave;
      osc.frequency.setValueAtTime(r.from, t);
      if (r.to !== r.from) osc.frequency.linearRampToValueAtTime(r.to, end);
      osc.connect(g);
      osc.start(t);
      osc.stop(end);
    }
    return true;
  } catch {
    return false;
  }
}

/** For tests: forget the context. */
export function resetUiSoundsForTest(): void {
  ctx = null;
}
