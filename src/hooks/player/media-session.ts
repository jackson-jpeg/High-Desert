"use client";

// MediaSession integration for useAudioPlayer: lock-screen / headset metadata,
// action handlers, and position state.
//
// Not behind withGlobals: navigator.mediaSession holds one handler per action,
// so a second instance's registration replaces the first's rather than adding
// to it, and both instances register the same callbacks.

import { useEffect } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { useLiveStore } from "@/stores/live-store";
import { getMediaElement } from "@/audio/engine";
import type { Episode } from "@/db/schema";

const ARTWORK = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
];

export const LIVE_ALBUM = "High Desert Live";

/**
 * What the lock screen shows. A listener with the screen off sees the station
 * change shows only here, so it follows every change: each new show by name,
 * and the break between shows as the station ID (not the show that just
 * ended). On the live station the album line says so.
 */
export function mediaMetadataFor(
  episode: Episode | null,
  live: { tuned: boolean; stationBreak: boolean },
): MediaMetadataInit | null {
  if (live.tuned && live.stationBreak) {
    return { title: "Station identification", artist: "Art Bell", album: LIVE_ALBUM, artwork: ARTWORK };
  }
  if (!episode) return null;
  return {
    title: episode.title || episode.fileName,
    artist: episode.guestName ? `Art Bell with ${episode.guestName}` : episode.artist || "Art Bell",
    album: live.tuned
      ? LIVE_ALBUM
      : episode.showType === "coast"
        ? "Coast to Coast AM"
        : episode.showType === "dreamland"
          ? "Dreamland"
          : "Art Bell Radio",
    artwork: ARTWORK,
  };
}

export interface MediaSessionControls {
  currentEpisode: Episode | null;
  playing: boolean;
  resumePlayback: () => Promise<void>;
  pausePlayback: () => void;
  playNext: () => void;
  playPrevious: () => void;
  seek: (seconds: number) => void;
}

export function useMediaSession({
  currentEpisode,
  playing,
  resumePlayback,
  pausePlayback,
  playNext,
  playPrevious,
  seek,
}: MediaSessionControls): void {
  const tuned = useLiveStore((s) => s.tuned);
  const stationBreak = useLiveStore((s) => s.phase === "station-id");

  // Metadata and playback state
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const session = navigator.mediaSession;
    const meta = mediaMetadataFor(currentEpisode, { tuned, stationBreak });
    session.metadata = meta ? new MediaMetadata(meta) : null;
    session.playbackState = playing ? "playing" : "paused";
  }, [currentEpisode, playing, tuned, stationBreak]);

  // Action handlers
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const session = navigator.mediaSession;

    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      // Explicit, never togglePlay(): the lock screen says which it wants, and
      // a toggle inverts whenever the store's `playing` is out of step with
      // the element — which is exactly when a listener reaches for it (HD-032).
      ["play", () => void resumePlayback()],
      ["pause", () => pausePlayback()],
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
  }, [resumePlayback, pausePlayback, playNext, playPrevious, seek]);

  // Update MediaSession position state on a timer rather than on every position
  // change — reading from getState() keeps this off the render path entirely.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentEpisode || !playing) return;

    const push = () => {
      const state = usePlayerStore.getState();
      // The break between shows has no timeline of its own worth showing.
      if (useLiveStore.getState().phase === "station-id") return;
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
    };

    push();
    const id = window.setInterval(push, 5000);
    return () => window.clearInterval(id);
  }, [currentEpisode, playing]);
}
