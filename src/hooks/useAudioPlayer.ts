"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import {
  initEngine,
  setEngineVolume,
  resumeContext,
  getMediaElement,
  notifySourceChanged,
  audioContext,
} from "@/audio/engine";
import { db } from "@/db";
import type { Episode } from "@/db/schema";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const positionTimerRef = useRef<number>(0);

  const {
    currentEpisode,
    objectUrl,
    playing,
    position,
    volume,
    playbackRate,
    error,
    loadEpisode,
    setPlaying,
    setPosition,
    setDuration,
    setError,
    stop,
  } = usePlayerStore();

  // Get or create the shared audio element
  const getAudio = useCallback((): HTMLAudioElement => {
    // Reuse the engine's existing element if available (handles multiple hook instances)
    const existing = getMediaElement();
    if (existing) {
      audioRef.current = existing;
      return existing;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "metadata";
      audioRef.current.crossOrigin = "anonymous";
      // Required for iOS background/lock screen playback
      audioRef.current.setAttribute("playsinline", "");
      audioRef.current.setAttribute("webkit-playsinline", "");
      initEngine(audioRef.current);
    }
    return audioRef.current;
  }, []);

  // Load and optionally play an episode
  const playEpisode = useCallback(
    async (episode: Episode, file?: File) => {
      const audio = getAudio();

      // Create object URL from file, or use sourceUrl for archive episodes
      let url: string;
      let isObjectUrl = false;
      if (file) {
        url = URL.createObjectURL(file);
        isObjectUrl = true;
      } else if (episode.sourceUrl) {
        url = episode.sourceUrl;
      } else {
        setError("No audio source available. Try re-importing this episode.");
        return;
      }

      setError(null);
      loadEpisode(episode, isObjectUrl ? url : "");
      notifySourceChanged();
      audio.src = url;
      audio.currentTime = episode.playbackPosition ?? 0;
      audio.playbackRate = usePlayerStore.getState().playbackRate;

      await resumeContext();
      try {
        if (audioRef.current) {
          await audioRef.current.play();
        }
        setPlaying(true);

        // Increment play count in DB
        if (episode.id) {
          db.episodes.update(episode.id, {
            playCount: (episode.playCount ?? 0) + 1,
            lastPlayedAt: Date.now(),
            updatedAt: Date.now(),
          }).catch((err) => { console.warn("[player] Failed to update play count:", err); });
        }
      } catch (err) {
        console.error("[player] Playback failed:", err);
        setError("Playback failed. The audio source may be unavailable.");
        // Revoke object URL on failure to prevent memory leaks
        if (isObjectUrl) URL.revokeObjectURL(url);
      }
    },
    [getAudio, loadEpisode, setPlaying, setError],
  );

  // Play/pause toggle
  const togglePlay = useCallback(async () => {
    const audio = getAudio();
    if (!audio.src) return;

    await resumeContext();

    if (playing) {
      if (audio) {
        audio.pause();
      }
      setPlaying(false);
    } else {
      try {
        if (audio) {
          await audio.play();
          setPlaying(true);
        }
      } catch (err) {
        console.error("[player] Play failed:", err);
      }
    }
  }, [getAudio, playing, setPlaying]);

  // Seek to a position in seconds
  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio();
      if (!audio.src || !audio.duration || !isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
      setPosition(audio.currentTime);
    },
    [getAudio, setPosition],
  );

  // Stop playback
  const stopPlayback = useCallback(() => {
    const audio = getAudio();
    audio.pause();
    audio.src = "";
    stop();
  }, [getAudio, stop]);

  // Play next track in queue
  const playNext = useCallback(() => {
    const state = usePlayerStore.getState();
    const nextEp = state.next();
    if (nextEp) {
      state.playTrack(nextEp);
    }
  }, []);

  // Play previous track (restart if >3s in, otherwise go back)
  const playPrevious = useCallback(() => {
    const state = usePlayerStore.getState();
    if (state.position > 3) {
      // Restart current track
      const audio = getAudio();
      if (audio.src) {
        audio.currentTime = 0;
        state.setPosition(0);
      }
      return;
    }
    const prevEp = state.previous();
    if (prevEp) {
      state.playTrack(prevEp);
    }
  }, [getAudio]);

  // Sync volume to engine
  useEffect(() => {
    setEngineVolume(volume);
  }, [volume]);

  // Sync playback rate
  useEffect(() => {
    const audio = getMediaElement();
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Position tracking timer
  useEffect(() => {
    if (playing) {
      positionTimerRef.current = window.setInterval(() => {
        const audio = getMediaElement();
        if (audio && !audio.paused) {
          usePlayerStore.getState().setPosition(audio.currentTime);
        }
      }, 250);
    } else {
      window.clearInterval(positionTimerRef.current);
    }
    return () => window.clearInterval(positionTimerRef.current);
  }, [playing]);

  // Listen for audio ended + errors
  useEffect(() => {
    const audio = getAudio();

    const onEnded = () => {
      const state = usePlayerStore.getState();

      // Repeat one: just replay current track
      if (state.repeat === "one") {
        const audio = getAudio();
        audio.currentTime = 0;
        audio.play().catch(() => setPlaying(false));
        return;
      }

      const nextEp = state.next();
      if (nextEp) {
        state.playTrack(nextEp);
      } else {
        setPlaying(false);
      }
    };

    const onError = () => {
      setError("Playback error. The audio source may be unavailable.");
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      // Clean up audio element only if it was created by this hook
      if (audioRef.current && audioRef.current.src) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        try {
          audioRef.current.load();
        } catch (_) {
          // ignore if element is already detached
        }
      }
    };
  }, [getAudio, setError, setPlaying, setDuration]);
    const onError = () => {
      setPlaying(false);
      const code = audio.error?.code;
      const messages: Record<number, string> = {
        1: "Playback aborted.",
        2: "Network error. Check your connection.",
        3: "Audio decoding failed.",
        4: "Audio source not supported or unavailable.",
      };
      setError(messages[code ?? 0] ?? "An unknown playback error occurred.");
    };

    // Sync store when iOS/lock screen controls trigger play/pause directly
    const onPlay = () => {
      if (!usePlayerStore.getState().playing) setPlaying(true);
    };
    const onPause = () => {
      if (usePlayerStore.getState().playing) setPlaying(false);
    };

    const { setBuffering } = usePlayerStore.getState();
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);
    const onPlaying = () => setBuffering(false);

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      // Disconnect AudioContext and clean up audio element
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load(); // force reset
      }
      // Close the AudioContext if it exists
      const { audioContext } = require("@/audio/engine");
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
    };
  }, [getAudio, setPlaying, setDuration, setError]);

  // Persist playback position periodically
  useEffect(() => {
    if (!currentEpisode?.id || !playing) return;

    const interval = window.setInterval(async () => {
      const { position: pos, currentEpisode: ep } =
        usePlayerStore.getState();
      if (ep?.id) {
        await db.episodes.update(ep.id, {
          playbackPosition: pos,
          lastPlayedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentEpisode?.id, playing]);

  // Flush position on page unload
  useEffect(() => {
    const flush = () => {
      const { position: pos, currentEpisode: ep } = usePlayerStore.getState();
      if (ep?.id && pos > 0) {
        // Dexie can't run in unload, so persist via a direct IDB transaction
        try {
          const req = indexedDB.open("HighDesertDB");
          req.onsuccess = () => {
            const idb = req.result;
            const tx = idb.transaction("episodes", "readwrite");
            const store = tx.objectStore("episodes");
            const getReq = store.get(ep.id!);
            getReq.onsuccess = () => {
              const record = getReq.result;
              if (record) {
                record.playbackPosition = pos;
                record.lastPlayedAt = Date.now();
                record.updatedAt = Date.now();
                store.put(record);
              }
            };
          };
        } catch {
          // Best-effort — if IDB fails during unload, position was saved within 5s
        }
      }
    };

    // visibilitychange fires more reliably on iOS than pagehide/beforeunload
    const onVisChange = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, []);

  // MediaSession API integration
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const session = navigator.mediaSession;

    if (currentEpisode) {
      session.metadata = new MediaMetadata({
        title: currentEpisode.title || currentEpisode.fileName,
        artist: currentEpisode.guestName
          ? `Art Bell with ${currentEpisode.guestName}`
          : currentEpisode.artist || "Art Bell",
        album: currentEpisode.showType === "coast"
          ? "Coast to Coast AM"
          : currentEpisode.showType === "dreamland"
            ? "Dreamland"
            : "Art Bell Radio",
        artwork: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    } else {
      session.metadata = null;
    }

    session.playbackState = playing ? "playing" : "paused";
  }, [currentEpisode, playing]);

  // MediaSession action handlers
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const session = navigator.mediaSession;

    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => togglePlay()],
      ["pause", () => togglePlay()],
      ["previoustrack", () => playPrevious()],
      ["nexttrack", () => playNext()],
      ["seekforward", (details) => {
        const offset = (details as MediaSessionActionDetails & { seekOffset?: number }).seekOffset ?? 30;
        const audio = getMediaElement();
        if (audio?.src) seek(audio.currentTime + offset);
      }],
      ["seekbackward", (details) => {
        const offset = (details as MediaSessionActionDetails & { seekOffset?: number }).seekOffset ?? 15;
        const audio = getMediaElement();
        if (audio?.src) seek(audio.currentTime - offset);
      }],
      ["seekto", (details) => {
        const seekTime = (details as MediaSessionActionDetails & { seekTime?: number }).seekTime;
        if (seekTime != null) seek(seekTime);
      }],
    ];

    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Some actions may not be supported
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [togglePlay, playNext, playPrevious, seek]);

  // Update MediaSession position state (throttled to avoid excessive updates)
  const lastPositionUpdateRef = useRef(0);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentEpisode || !playing) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < 5000) return;
    lastPositionUpdateRef.current = now;

    const state = usePlayerStore.getState();
    if (state.duration > 0 && isFinite(state.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          playbackRate: state.playbackRate,
          position: Math.min(Math.max(0, state.position), state.duration),
        });
      } catch {
        // ignore
      }
    }
  }, [currentEpisode, playing, position]);

  return {
    playEpisode,
    togglePlay,
    seek,
    stopPlayback,
    playNext,
    playPrevious,
    audioRef,
    currentEpisode,
    objectUrl,
    playing,
    position,
    volume,
    playbackRate,
    error,
  };
}
