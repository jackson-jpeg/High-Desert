"use client";

import { useEffect, useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { ContinueBanner } from "@/components/library/ContinueBanner";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { db, getPreference, setPreference } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { getCachedAudio, cacheAudioBlob } from "@/lib/audio/cache";
import { seedLibraryIfEmpty } from "@/lib/db/seed";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { playEpisode, togglePlay, seek, playNext, playPrevious } = useAudioPlayer();
  const position = usePlayerStore((s) => s.position);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const [continueEpisode, setContinueEpisode] = useState<Episode | null>(null);

  // Handle ?admin / ?viewer URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) {
      useAdminStore.getState().setAdmin(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("viewer")) {
      useAdminStore.getState().setAdmin(false);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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

      // Also enqueue so manually-played episodes enter the queue
      enqueue(episode);

      // Archive episodes stream directly — no file picker needed
      if (episode.sourceUrl) {
        try {
          await playEpisode(episode);
        } catch (err) {
          console.error("[layout] Failed to play archive episode:", err);
        }
        return;
      }

      // For local files, check OPFS cache first
      try {
        const cached = await getCachedAudio(episode.fileHash);
        if (cached) {
          await playEpisode(episode, new File([cached], episode.fileName, { type: "audio/mpeg" }));
          return;
        }
      } catch {
        // OPFS not available, fall through to file picker
      }

      // Open a file picker as fallback
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";

        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          const timer = setTimeout(() => resolve(null), 60000);
          input.addEventListener("cancel", () => {
            clearTimeout(timer);
            resolve(null);
          });
          input.click();
        });

        if (file) {
          await playEpisode(episode, file);
          // Cache to OPFS in background after playback starts
          cacheAudioBlob(episode.fileHash, file).catch((err) => {
            console.warn("[layout] OPFS cache failed:", err);
          });
        }
      } catch (err) {
        console.error("[layout] Failed to play episode:", err);
      }
    };

    window.addEventListener("hd:play-episode", handler);
    return () => window.removeEventListener("hd:play-episode", handler);
  }, [playEpisode, enqueue]);

  // Persist last-episode-id, queue, and record history whenever episode changes
  useEffect(() => {
    return usePlayerStore.subscribe((state, prevState) => {
      if (state.currentEpisode?.id !== prevState.currentEpisode?.id && state.currentEpisode?.id) {
        setPreference("last-episode-id", String(state.currentEpisode.id));
        // Record listening history entry
        const ep = state.currentEpisode;
        db.history.add({
          episodeId: ep.id!,
          timestamp: Date.now(),
          duration: 0,
          episodeTitle: ep.title || ep.fileName,
          guestName: ep.guestName,
        }).catch(() => {});
      }
      // Persist queue when it changes
      if (state.queue !== prevState.queue || state.queueIndex !== prevState.queueIndex) {
        const queueIds = state.queue.map((e) => e.id).filter(Boolean);
        setPreference("queue-ids", JSON.stringify(queueIds));
        setPreference("queue-index", String(state.queueIndex));
      }
    });
  }, []);

  // On mount, seed library if empty, then restore state
  useEffect(() => {
    seedLibraryIfEmpty().catch(() => {});
  }, []);

  // On mount, load last-played episode and restore queue
  useEffect(() => {
    // Restore continue banner
    getPreference("last-episode-id").then(async (idStr) => {
      if (!idStr) return;
      const id = parseInt(idStr, 10);
      if (isNaN(id)) return;
      const ep = await db.episodes.get(id);
      if (ep && (ep.playbackPosition ?? 0) > 0) {
        setContinueEpisode(ep);
      }
    });

    // Restore queue from prefs
    Promise.all([
      getPreference("queue-ids"),
      getPreference("queue-index"),
    ]).then(async ([idsJson, indexStr]) => {
      if (!idsJson) return;
      try {
        const ids: number[] = JSON.parse(idsJson);
        if (!Array.isArray(ids) || ids.length === 0) return;
        const episodes = await db.episodes.where("id").anyOf(ids).toArray();
        // Restore original order
        const byId = new Map(episodes.map((e) => [e.id, e]));
        const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Episode[];
        if (ordered.length > 0) {
          const idx = parseInt(indexStr ?? "-1", 10);
          usePlayerStore.getState().restoreQueue(
            ordered,
            Math.min(Math.max(idx, -1), ordered.length - 1),
          );
        }
      } catch {
        // Ignore corrupt queue data
      }
    });
  }, []);

  const handleResume = useCallback((episode: Episode) => {
    setContinueEpisode(null);
    window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: episode }));
  }, []);

  const handleDismissContinue = useCallback(() => {
    setContinueEpisode(null);
  }, []);

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
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setVolume(Math.min(1, volume + 0.05));
          }
          break;
        case "ArrowDown":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setVolume(Math.max(0, volume - 0.05));
          }
          break;
        case "KeyN":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            playNext();
          }
          break;
        case "KeyP":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            playPrevious();
          }
          break;
        case "KeyM":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            usePlayerStore.getState().toggleMute();
          }
          break;
        case "Slash":
        case "KeyF":
          if (e.ctrlKey || e.metaKey || e.code === "Slash") {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("hd:focus-search"));
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek, position, volume, setVolume, playNext, playPrevious]);

  // Episode count for status bar — handled via DesktopShell's episodeCount prop
  const episodeCount = useLiveQuery(() => db.episodes.count(), []);

  return (
    <DesktopShell
      player={
        <>
          {continueEpisode && !currentEpisode && (
            <ContinueBanner
              episode={continueEpisode}
              onResume={handleResume}
              onDismiss={handleDismissContinue}
            />
          )}
          <AudioPlayer />
        </>
      }
      episodeCount={episodeCount ?? 0}
    >
      {children}
    </DesktopShell>
  );
}
