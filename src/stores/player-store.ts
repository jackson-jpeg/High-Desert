import { create } from "zustand";
import type { Episode } from "@/lib/db/schema";

export interface PlayerState {
  // Current track
  currentEpisode: Episode | null;
  objectUrl: string | null;

  // Playback state
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-1
  playbackRate: number;

  // UI
  mini: boolean;
  error: string | null;

  // Actions
  loadEpisode: (episode: Episode, objectUrl: string) => void;
  setPlaying: (playing: boolean) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  setError: (error: string | null) => void;
  toggleMini: () => void;
  stop: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentEpisode: null,
  objectUrl: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  playbackRate: 1,
  mini: true,
  error: null,

  loadEpisode: (episode, objectUrl) => {
    // Revoke previous object URL
    const prev = get().objectUrl;
    if (prev) URL.revokeObjectURL(prev);

    set({
      currentEpisode: episode,
      objectUrl,
      playing: false,
      position: episode.playbackPosition ?? 0,
      duration: episode.duration ?? 0,
    });
  },

  setPlaying: (playing) => set({ playing }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  setError: (error) => set({ error }),
  toggleMini: () => set((s) => ({ mini: !s.mini })),

  stop: () => {
    const prev = get().objectUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      currentEpisode: null,
      objectUrl: null,
      playing: false,
      position: 0,
      duration: 0,
    });
  },
}));
