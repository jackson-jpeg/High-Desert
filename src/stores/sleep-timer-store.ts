import { create } from "zustand";
import { usePlayerStore } from "./player-store";

export type SleepPreset = number;

interface SleepTimerState {
  /** Seconds remaining, 0 = off */
  remaining: number;
  /** Whether the timer is actively counting down */
  active: boolean;
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

  start: (minutes) => {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
      get().cancel();
      return;
    }
    set({ remaining: minutes * 60, active: true });
    startTicking();
  },

  cancel: () => {
    stopTicking();
    set({ remaining: 0, active: false });
  },

  tick: () => {
    const { remaining, active } = get();
    if (!active || remaining <= 0) {
      stopTicking();
      set({ remaining: 0, active: false });
      return;
    }

    const next = remaining - 1;

    // Fade volume in the last 30 seconds
    if (next <= 30 && next > 0) {
      const fadeVolume = next / 30;
      const player = usePlayerStore.getState();
      // Only fade if currently playing
      if (player.playing) {
        player.setVolume(Math.min(player.volume, fadeVolume * player.preMuteVolume));
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
      // Restore volume to pre-fade level
      player.setVolume(player.preMuteVolume);
      set({ remaining: 0, active: false });
    } else {
      set({ remaining: next });
    }
  },
}));
