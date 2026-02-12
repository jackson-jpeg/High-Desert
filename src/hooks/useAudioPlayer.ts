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
    loadEpisode,
    setPlaying,
    setPosition,
    setDuration,
    stop,
  } = usePlayerStore();

  // Get or create the shared audio element
  const getAudio = useCallback((): HTMLAudioElement => {
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
      }
    },
    [getAudio, loadEpisode, setPlaying],
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

  // Listen for audio ended
  useEffect(() => {
    const audio = getAudio();

    const onEnded = () => setPlaying(false);
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [getAudio, setPlaying, setDuration]);

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
    audioRef,
    currentEpisode,
    objectUrl,
    playing,
    position,
    volume,
    playbackRate,
  };
}
