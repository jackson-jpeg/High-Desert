import { create } from "zustand";
import type { Episode } from "@/db/schema";
import { toast } from "@/stores/toast-store";

export type RepeatMode = "off" | "one" | "all";

export interface PlayerState {
  // Current track
  currentEpisode: Episode | null;
  objectUrl: string | null;

  // Queue
  queue: Episode[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;

  // Playback state
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-1
  preMuteVolume: number; // volume before muting, for restore
  playbackRate: number;

  // UI
  mini: boolean;
  error: string | null;
  buffering: boolean;

  // Actions
  loadEpisode: (episode: Episode, objectUrl: string) => void;
  setPlaying: (playing: boolean) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setError: (error: string | null) => void;
  setBuffering: (buffering: boolean) => void;
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

  // Queue reorder
  moveInQueue: (fromIndex: number, toIndex: number) => void;

  // Shuffle & repeat
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  // Unified play trigger
  playTrack: (episode: Episode) => void;

  // Persistence
  restoreQueue: (queue: Episode[], queueIndex: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentEpisode: null,
  objectUrl: null,
  queue: [],
  queueIndex: -1,
  shuffle: false,
  repeat: "off" as RepeatMode,
  playing: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  preMuteVolume: 0.8,
  playbackRate: 1,
  mini: true,
  error: null,
  buffering: false,

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
  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set((s) => ({
      volume: clamped,
      // Track pre-mute volume when volume is being set to a non-zero value
      preMuteVolume: clamped > 0 ? clamped : s.preMuteVolume,
    }));
  },
  toggleMute: () => {
    const { volume, preMuteVolume } = get();
    if (volume > 0) {
      set({ preMuteVolume: volume, volume: 0 });
    } else {
      set({ volume: preMuteVolume > 0 ? preMuteVolume : 0.8 });
    }
  },
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  setError: (error) => set({ error }),
  setBuffering: (buffering) => set({ buffering }),
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
    // "Area 51 Caller" toast when adding to queue (not on first play)
    if (queue.length > 0) {
      toast.caller(episode.title || episode.fileName);
    }
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
    const { queue, queueIndex, shuffle, repeat } = get();

    // Repeat one: return current track again (index stays the same)
    if (repeat === "one" && queueIndex >= 0 && queueIndex < queue.length) {
      return queue[queueIndex];
    }

    // Shuffle: pick random different track
    if (shuffle && queue.length > 1) {
      let nextIdx: number;
      do {
        nextIdx = Math.floor(Math.random() * queue.length);
      } while (nextIdx === queueIndex && queue.length > 1);
      set({ queueIndex: nextIdx });
      return queue[nextIdx];
    }

    const nextIdx = queueIndex + 1;
    if (nextIdx >= queue.length) {
      // Repeat all: wrap around
      if (repeat === "all" && queue.length > 0) {
        set({ queueIndex: 0 });
        return queue[0];
      }
      return null;
    }
    set({ queueIndex: nextIdx });
    return queue[nextIdx];
  },

  previous: () => {
    const { queue, queueIndex } = get();
    const prevIdx = queueIndex - 1;
    if (prevIdx < 0) return null;
    set({ queueIndex: prevIdx });
    return queue[prevIdx];
  },

  hasNext: () => {
    const { queue, queueIndex, repeat, shuffle } = get();
    if (repeat === "one" || repeat === "all" || shuffle) return queue.length > 0;
    return queueIndex + 1 < queue.length;
  },

  hasPrevious: () => {
    const { queueIndex } = get();
    return queueIndex > 0;
  },

  moveInQueue: (fromIndex, toIndex) => {
    const { queue, queueIndex } = get();
    if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return;
    if (fromIndex === toIndex) return;

    const newQueue = [...queue];
    const [moved] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, moved);

    // Update queueIndex to track current playing item
    let newIndex = queueIndex;
    if (queueIndex === fromIndex) {
      newIndex = toIndex;
    } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
      newIndex = queueIndex - 1;
    } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
      newIndex = queueIndex + 1;
    }

    set({ queue: newQueue, queueIndex: newIndex });
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  cycleRepeat: () => set((s) => {
    const modes: RepeatMode[] = ["off", "all", "one"];
    const idx = modes.indexOf(s.repeat);
    return { repeat: modes[(idx + 1) % modes.length] };
  }),

  playTrack: (episode) => {
    // Unified: update queue index if in queue, then dispatch play event
    const { queue } = get();
    const idx = queue.findIndex((e) => e.id === episode.id);
    if (idx !== -1) {
      set({ queueIndex: idx });
    }
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  },

  restoreQueue: (queue, queueIndex) => {
    set({ queue, queueIndex });
  },
}));
