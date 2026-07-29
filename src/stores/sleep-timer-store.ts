import { create } from "zustand";
import { usePlayerStore } from "./player-store";

export type SleepPreset = number;

/** How long the volume ramp before sleep lasts, in seconds. */
const FADE_SECONDS = 30;

interface SleepTimerState {
  /** Seconds remaining, 0 = off */
  remaining: number;
  /** Whether the timer is actively counting down */
  active: boolean;
  /**
   * The listener's volume as it was when the fade began, captured once.
   * `null` whenever no fade is in progress.
   *
   * This exists because `preMuteVolume` cannot be used for it.
   * `usePlayerStore.setVolume()` writes `preMuteVolume` on every call with a
   * non-zero value, so the fade was reading back its own output: each tick
   * multiplied the already-faded volume by the ramp again, which decayed
   * geometrically (0.7% of the original with fifteen seconds still to run) and
   * then "restored" that same faded number at zero. The listener was left at a
   * couple of percent for good, with `preMuteVolume` destroyed too so unmuting
   * could not recover it, and nothing on screen to say why the app had gone
   * quiet overnight.
   */
  fadeFrom: number | null;
  /** Start a sleep timer with the given minutes */
  start: (minutes: number) => void;
  /** Cancel the timer */
  cancel: () => void;
  /** Called every second by the tick interval */
  tick: () => void;
}

let tickInterval: ReturnType<typeof setInterval> | null = null;

function startTicking() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    useSleepTimerStore.getState().tick();
  }, 1000);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export const useSleepTimerStore = create<SleepTimerState>((set, get) => ({
  remaining: 0,
  active: false,
  fadeFrom: null,

  start: (minutes) => {
    if (minutes <= 0) {
      get().cancel();
      return;
    }
    set({ remaining: minutes * 60, active: true, fadeFrom: null });
    startTicking();
  },

  cancel: () => {
    stopTicking();
    // Cancelling part-way through the ramp must hand the volume back. Otherwise
    // the listener who changed their mind at 0:20 is left at a third of the
    // volume they set, with the control that did it already gone from the UI.
    const { fadeFrom } = get();
    if (fadeFrom !== null) usePlayerStore.getState().setVolume(fadeFrom);
    set({ remaining: 0, active: false, fadeFrom: null });
  },

  tick: () => {
    const { remaining, active } = get();
    if (!active || remaining <= 0) {
      stopTicking();
      set({ remaining: 0, active: false, fadeFrom: null });
      return;
    }

    const next = remaining - 1;

    // Fade volume over the last FADE_SECONDS
    if (next <= FADE_SECONDS && next > 0) {
      const player = usePlayerStore.getState();
      // Only fade if currently playing
      if (player.playing) {
        // Capture the starting volume once, then ramp from that fixed value.
        // Reading the player's live volume (or preMuteVolume) on each tick
        // feeds the fade its own output — see the note on `fadeFrom`.
        let { fadeFrom } = get();
        if (fadeFrom === null) {
          fadeFrom = player.volume > 0 ? player.volume : player.preMuteVolume;
          set({ fadeFrom });
        }
        player.setVolume((next / FADE_SECONDS) * fadeFrom);
      }
    }

    if (next <= 0) {
      // Time's up — pause playback and restore volume
      stopTicking();
      const player = usePlayerStore.getState();
      if (player.playing) {
        player.setPlaying(false);
        // Pause the actual audio element
        const audio = document.querySelector("audio");
        if (audio) audio.pause();
      }
      // Restore only what we actually took. A timer that expired without ever
      // fading has no business moving the volume slider.
      const { fadeFrom } = get();
      if (fadeFrom !== null) player.setVolume(fadeFrom);
      set({ remaining: 0, active: false, fadeFrom: null });
    } else {
      set({ remaining: next });
    }
  },
}));
