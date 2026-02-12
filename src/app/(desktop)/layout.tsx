"use client";

import { useEffect, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { usePlayerStore } from "@/stores/player-store";
import { db, getPreference, setPreference } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { playEpisode, togglePlay, seek } = useAudioPlayer();
  const position = usePlayerStore((s) => s.position);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const playing = usePlayerStore((s) => s.playing);

  // Restore volume from prefs on mount
  useEffect(() => {
    getPreference("volume").then((v) => {
      if (v) setVolume(parseFloat(v));
    });
  }, [setVolume]);

  // Persist volume changes
  useEffect(() => {
    setPreference("volume", String(volume));
  }, [volume]);

  // Listen for custom play-episode events from library
  useEffect(() => {
    const handler = async (e: Event) => {
      const episode = (e as CustomEvent<Episode>).detail;

      // For local files we need to retrieve the file from the DB path
      // Since we're using IndexedDB and files are referenced by path,
      // we need to ask the user to re-select the folder.
      // For now, we'll open a file picker for the specific file.
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";

        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          // Auto-cancel after timeout
          const timer = setTimeout(() => resolve(null), 60000);
          input.addEventListener("cancel", () => {
            clearTimeout(timer);
            resolve(null);
          });
          input.click();
        });

        if (file) {
          await playEpisode(episode, file);
        }
      } catch (err) {
        console.error("[layout] Failed to play episode:", err);
      }
    };

    window.addEventListener("hd:play-episode", handler);
    return () => window.removeEventListener("hd:play-episode", handler);
  }, [playEpisode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(position - 15);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(position + 30);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek, position, volume, setVolume]);

  // Episode count for status bar — handled via DesktopShell's episodeCount prop
  const episodeCount = useLiveQuery(() => db.episodes.count(), []);

  return (
    <DesktopShell
      player={<AudioPlayer />}
      episodeCount={episodeCount ?? 0}
    >
      {children}
    </DesktopShell>
  );
}
