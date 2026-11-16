import { create } from "zustand";
import { safeSetItem } from "@/lib/utils/safe-storage";

/**
 * Level and Clean up (docs/audio-processing/README.md): the listener's two
 * switches, whether this device can run them, and what the processor is
 * doing right now (for the DSP panel's lights).
 *
 * The switches are remembered per listener in localStorage (`hd-dsp`), read
 * after mount (`hydrate()`), never during render: the server renders the
 * defaults, so reading storage in render would mismatch on hydration (the
 * admin store learned this).
 *
 * This store holds state only. The audio graph (src/audio/processing.ts)
 * subscribes to it and sends the switches to the worklet; the counters are
 * sent from there too.
 */

export const DSP_STORAGE_KEY = "hd-dsp";

/**
 * Clean up is built but not released: it misses the hiss target on the
 * heaviest-hiss shows (docs/audio-processing/README.md, "Clean up is held
 * back"). Until it passes every target its switch is hidden and it never
 * runs, whatever a listener saved. Jackson, 2026-11-15: ship Level, keep
 * Clean up hidden, deploy it on its own once it passes.
 */
export const CLEANUP_RELEASED = false;
/**
 * The preview: `localStorage["hd-dsp-preview"] = "cleanup"` shows the hidden
 * switch in that one browser (the e2e specs, and listening on the live site).
 */
export const DSP_PREVIEW_KEY = "hd-dsp-preview";

/** Whether this browser is offered Clean up. Reads storage: call after mount. */
export function cleanupOffered(): boolean {
  if (CLEANUP_RELEASED) return true;
  try {
    return localStorage.getItem(DSP_PREVIEW_KEY) === "cleanup";
  } catch {
    return false;
  }
}

/** Level is on unless the listener turned it off; Clean up is off unless they turned it on. */
export const DEFAULT_LEVEL = true;
export const DEFAULT_CLEANUP = false;

/**
 *   pending      not decided yet (before mount, or the worklet is loading)
 *   ok           both switches work
 *   ios          iPhone or iPad: off, Web Audio would stop the show on the lock screen
 *   unsupported  this browser has no AudioWorklet
 *   failed       the processor failed here; plain playback took over
 */
export type DspAvailability = "pending" | "ok" | "ios" | "unsupported" | "failed";

/** The one-line reason under greyed switches. No em dashes: user-facing copy. */
export const UNAVAILABLE_REASON: Record<Exclude<DspAvailability, "pending" | "ok">, string> = {
  ios: "Not on iPhone or iPad yet. Playback is unchanged.",
  unsupported: "This browser can't do it. Playback is unchanged.",
  failed: "Stopped working on this device. Playing normally.",
};

export interface DspMeter {
  /** Level's gain right now, dB. */
  gainDb: number;
  /** 0 (talk) .. 1 (music): how far Clean up is easing off for music. */
  music: number;
  /** Hum lines being notched. */
  humLines: number;
  /** Clean up's mix, 0..1 (fading in or out). */
  cleanupMix: number;
  /** Level's mix, 0..1. */
  levelMix: number;
  /** Where Level's gain comes from: the show's two-pass envelope, or the live leveler (no envelope yet). */
  levelSource: "envelope" | "live";
}

interface ProcessingState {
  level: boolean;
  cleanup: boolean;
  /** Whether the Clean up switch is shown and may run (cleanupOffered(), read at hydrate). */
  cleanupOffered: boolean;
  availability: DspAvailability;
  meter: DspMeter | null;
  /** True once hydrate() has read the listener's choice. */
  hydrated: boolean;
  setLevel: (on: boolean) => void;
  setCleanup: (on: boolean) => void;
  setAvailability: (a: DspAvailability) => void;
  setMeter: (m: DspMeter | null) => void;
  /** Read the remembered switches (call once, after mount). */
  hydrate: () => void;
}

function save(level: boolean, cleanup: boolean): void {
  // Private mode or storage off: the choice lasts this page only.
  safeSetItem("local", DSP_STORAGE_KEY, JSON.stringify({ level, cleanup }));
}

export function readSaved(): { level: boolean; cleanup: boolean } {
  try {
    const raw = localStorage.getItem(DSP_STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { level?: unknown; cleanup?: unknown };
      return {
        level: typeof v.level === "boolean" ? v.level : DEFAULT_LEVEL,
        cleanup: cleanupOffered() && typeof v.cleanup === "boolean" ? v.cleanup : DEFAULT_CLEANUP,
      };
    }
  } catch {
    // Unreadable: the defaults.
  }
  return { level: DEFAULT_LEVEL, cleanup: DEFAULT_CLEANUP };
}

export const useProcessingStore = create<ProcessingState>((set, get) => ({
  level: DEFAULT_LEVEL,
  cleanup: DEFAULT_CLEANUP,
  cleanupOffered: false,
  availability: "pending",
  meter: null,
  hydrated: false,
  setLevel: (on) => {
    set({ level: on });
    save(on, get().cleanup);
  },
  setCleanup: (on) => {
    if (on && !get().cleanupOffered) return;
    set({ cleanup: on });
    save(get().level, on);
  },
  setAvailability: (availability) => set({ availability }),
  setMeter: (meter) => set({ meter }),
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...readSaved(), cleanupOffered: cleanupOffered(), hydrated: true });
  },
}));

/** Whether the switches can be used (not greyed). */
export function switchesUsable(a: DspAvailability): boolean {
  return a === "ok" || a === "pending";
}
