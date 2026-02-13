import { create } from "zustand";
import type { Episode } from "@/lib/db/schema";

export interface PlayerState {
  // Current track
  currentEpisode: Episode | null;
  objectUrl: string | null;

  // Queue
  queue: Episode[];
  queueIndex: number;

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

  // Queue actions
  enqueue: (episode: Episode) => void;
  enqueueNext: (episode: Episode) => void;
  enqueueMany: (episodes: Episode[]) => void;
  playFromQueue: (index: number) => Episode | null;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  next: () => Episode | null;
  previous: () => Episode | null;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentEpisode: null,
  objectUrl: null,
  queue: [],
  queueIndex: -1,
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

    // If episode is already in queue, update index; otherwise insert after current
    const { queue, queueIndex } = get();
    const existingIdx = queue.findIndex((e) => e.id === episode.id);

    if (existingIdx !== -1) {
      set({
        currentEpisode: episode,
        objectUrl,
        playing: false,
        position: episode.playbackPosition ?? 0,
        duration: episode.duration ?? 0,
        queueIndex: existingIdx,
      });
    } else {
      const insertAt = queueIndex + 1;
      const newQueue = [...queue];
      newQueue.splice(insertAt, 0, episode);
      set({
        currentEpisode: episode,
        objectUrl,
        playing: false,
        position: episode.playbackPosition ?? 0,
        duration: episode.duration ?? 0,
        queue: newQueue,
        queueIndex: insertAt,
      });
    }
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
      queue: [],
      queueIndex: -1,
    });
  },

  enqueue: (episode) => {
    const { queue } = get();
    // Don't add duplicates
    if (queue.some((e) => e.id === episode.id)) return;
    set({ queue: [...queue, episode] });
  },

  enqueueNext: (episode) => {
    const { queue, queueIndex } = get();
    if (queue.some((e) => e.id === episode.id)) return;
    const newQueue = [...queue];
    newQueue.splice(queueIndex + 1, 0, episode);
    set({ queue: newQueue });
  },

  enqueueMany: (episodes) => {
    const { queue } = get();
    const existingIds = new Set(queue.map((e) => e.id));
    const newEps = episodes.filter((e) => !existingIds.has(e.id));
    if (newEps.length === 0) return;
    set({ queue: [...queue, ...newEps] });
  },

  playFromQueue: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return null;
    set({ queueIndex: index });
    return queue[index];
  },

  removeFromQueue: (index) => {
    const { queue, queueIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const newQueue = [...queue];
    newQueue.splice(index, 1);

    let newIndex = queueIndex;
    if (index < queueIndex) {
      newIndex = queueIndex - 1;
    } else if (index === queueIndex) {
      // Removing current track — keep index, will point to next
      newIndex = Math.min(queueIndex, newQueue.length - 1);
    }

    set({ queue: newQueue, queueIndex: newIndex });
  },

  clearQueue: () => {
    set({ queue: [], queueIndex: -1 });
  },

  next: () => {
    const { queue, queueIndex } = get();
    const nextIdx = queueIndex + 1;
    if (nextIdx >= queue.length) return null;
    return queue[nextIdx];
  },

  previous: () => {
    const { queue, queueIndex } = get();
    const prevIdx = queueIndex - 1;
    if (prevIdx < 0) return null;
    return queue[prevIdx];
  },

  hasNext: () => {
    const { queue, queueIndex } = get();
    return queueIndex + 1 < queue.length;
  },

  hasPrevious: () => {
    const { queueIndex } = get();
    return queueIndex > 0;
  },
}));
