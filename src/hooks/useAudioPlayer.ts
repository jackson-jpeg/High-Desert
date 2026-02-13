"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import {
  initEngine,
  setEngineVolume,
  resumeContext,
  getMediaElement,
} from "@/lib/audio/engine";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";

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
      if (file) {
        url = URL.createObjectURL(file);
      } else if (episode.sourceUrl) {
        url = episode.sourceUrl;
      } else {
        return;
      }

      setError(null);
      loadEpisode(episode, url);
      audio.src = url;
      audio.currentTime = episode.playbackPosition ?? 0;
      audio.playbackRate = usePlayerStore.getState().playbackRate;

      await resumeContext();
      try {
        await audio.play();
        setPlaying(true);
      } catch (err) {
        console.error("[player] Playback failed:", err);
        setError("Playback failed. The audio source may be unavailable.");
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
      audio.pause();
      setPlaying(false);
    } else {
      try {
        await audio.play();
        setPlaying(true);
      } catch (err) {
        console.error("[player] Play failed:", err);
      }
    }
  }, [getAudio, playing, setPlaying]);

  // Seek to a position in seconds
  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio();
      if (!audio.src) return;
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || 0));
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
    const nextEp = usePlayerStore.getState().next();
    if (nextEp) {
      usePlayerStore.getState().playFromQueue(
        usePlayerStore.getState().queueIndex + 1,
      );
      window.dispatchEvent(
        new CustomEvent("hd:play-episode", { detail: nextEp }),
      );
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
      state.playFromQueue(state.queueIndex - 1);
      window.dispatchEvent(
        new CustomEvent("hd:play-episode", { detail: prevEp }),
      );
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
      const nextEp = usePlayerStore.getState().next();
      if (nextEp) {
        usePlayerStore.getState().playFromQueue(
          usePlayerStore.getState().queueIndex + 1,
        );
        window.dispatchEvent(
          new CustomEvent("hd:play-episode", { detail: nextEp }),
        );
      } else {
        setPlaying(false);
      }
    };
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };
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

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
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
