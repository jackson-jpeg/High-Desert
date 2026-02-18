import { create } from "zustand";
import type { Episode } from "@/db/schema";

export interface RadioDialState {
  // Tuning position (days from earliest episode)
  position: number;
  // Currently locked episode
  lockedEpisode: Episode | null;
  // Signal strength 0-1
  signalStrength: number;
  // Auto-scan state
  scanning: "forward" | "backward" | null;
  // Whether radio static audio is enabled
  staticEnabled: boolean;
  // Sub-station index for same-date episodes
  subStationIndex: number;
  // Zoom level (px per day)
  zoom: number;

  // Actions
  setPosition: (pos: number) => void;
  setZoom: (zoom: number) => void;
  tune: (delta: number) => void;
  lockEpisode: (ep: Episode | null) => void;
  setSignalStrength: (s: number) => void;
  startScan: (dir: "forward" | "backward") => void;
  stopScan: () => void;
  toggleStatic: () => void;
  setSubStationIndex: (i: number) => void;
}

export const useRadioDialStore = create<RadioDialState>((set, get) => ({
  position: 0,
  lockedEpisode: null,
  signalStrength: 0,
  scanning: null,
  staticEnabled: true,
  subStationIndex: 0,
  zoom: 2, // px per day (default)

  setPosition: (pos) => set({ position: pos, subStationIndex: 0 }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(10, zoom)) }),

  tune: (delta) => {
    const { position } = get();
    set({ position: position + delta, subStationIndex: 0 });
  },

  lockEpisode: (ep) => set({ lockedEpisode: ep }),

  setSignalStrength: (s) => set({ signalStrength: Math.max(0, Math.min(1, s)) }),

  startScan: (dir) => set({ scanning: dir }),

  stopScan: () => set({ scanning: null }),

  toggleStatic: () => set((s) => ({ staticEnabled: !s.staticEnabled })),

  setSubStationIndex: (i) => set({ subStationIndex: i }),
}));
