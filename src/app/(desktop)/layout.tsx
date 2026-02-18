"use client";

import { useEffect, useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { AudioPlayer } from "@/components/player/AudioPlayer";
// ContinueBanner replaced by ContinueListening on library page
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { db, getPreference, setPreference } from "@/db";
import type { Episode } from "@/db/schema";
import { getCachedAudio, cacheAudioBlob } from "@/audio/cache";
import { seedLibraryIfEmpty } from "@/db/seed";
import { DBErrorBoundary } from "@/components/DBErrorBoundary";
import { playStartupSound } from "@/audio/startup-sound";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { playEpisode, togglePlay, seek, playNext, playPrevious } = useAudioPlayer();
  const position = usePlayerStore((s) => s.position);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  // Continue listening is now handled by ContinueListening on the library page

  // Handle ?viewer URL param on mount (logout only — login requires password)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("viewer")) {
      useAdminStore.getState().logout();
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

      // Resolve streaming URL from archiveIdentifier if available
      if (!episode.sourceUrl && episode.archiveIdentifier) {
        try {
          const [identifier, fileName] = episode.archiveIdentifier.includes("/")
            ? [episode.archiveIdentifier.split("/")[0], episode.archiveIdentifier.split("/").slice(1).join("/")]
            : [episode.archiveIdentifier, null];

          if (fileName) {
            // Direct URL construction
            const resolvedUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(fileName)}`;
            episode.sourceUrl = resolvedUrl;
          } else {
            // Fetch metadata to find the best audio file
            const res = await fetch(`/api/archive/metadata?id=${encodeURIComponent(identifier)}`);
            if (res.ok) {
              const data = await res.json();
              const files = data.files as { name: string; format: string }[];
              const best = files.find((f) => f.format === "VBR MP3") || files.find((f) => f.format.includes("MP3")) || files[0];
              if (best) {
                episode.sourceUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(best.name)}`;
              }
            }
          }

          if (episode.sourceUrl) {
            // Persist the resolved URL so we don't have to do this again
            if (episode.id) {
              db.episodes.update(episode.id, { sourceUrl: episode.sourceUrl }).catch(() => {});
            }
            await playEpisode(episode);
            return;
          }
        } catch (err) {
          console.error("[layout] Failed to resolve archive URL:", err);
        }
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

  // Scan preview: brief audio snippet during radio scan
  useEffect(() => {
    let previewAudio: HTMLAudioElement | null = null;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;

    const handlePreview = async (e: Event) => {
      const episode = (e as CustomEvent<Episode>).detail;
      if (!episode.sourceUrl) return;

      // Don't preview if main player is playing
      if (usePlayerStore.getState().playing) return;

      try {
        // Stop any existing preview
        if (previewAudio) {
          previewAudio.pause();
          previewAudio.src = "";
        }

        previewAudio = new Audio(episode.sourceUrl);
        previewAudio.volume = 0;
        previewAudio.crossOrigin = "anonymous";

        // Start from a random point (skip first 30s intro if long enough)
        previewAudio.currentTime = (episode.duration && episode.duration > 120)
          ? 30 + Math.random() * Math.min(episode.duration - 60, 300)
          : 0;

        await previewAudio.play();

        // Fade in over 300ms
        let vol = 0;
        const fadeIn = setInterval(() => {
          vol = Math.min(vol + 0.05, 0.3);
          if (previewAudio) previewAudio.volume = vol;
          if (vol >= 0.3) clearInterval(fadeIn);
        }, 30);

        // Auto-fade-out after 2.5s
        fadeTimer = setTimeout(() => {
          if (!previewAudio) return;
          const fadeOut = setInterval(() => {
            if (!previewAudio) { clearInterval(fadeOut); return; }
            previewAudio.volume = Math.max(0, previewAudio.volume - 0.05);
            if (previewAudio.volume <= 0) {
              clearInterval(fadeOut);
              previewAudio.pause();
              previewAudio.src = "";
            }
          }, 30);
        }, 2500);
      } catch {
        // Preview failed silently — not critical
      }
    };

    const handlePreviewStop = () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      if (previewAudio) {
        // Quick fade out
        const audio = previewAudio;
        const fadeOut = setInterval(() => {
          audio.volume = Math.max(0, audio.volume - 0.1);
          if (audio.volume <= 0) {
            clearInterval(fadeOut);
            audio.pause();
            audio.src = "";
          }
        }, 20);
        previewAudio = null;
      }
    };

    window.addEventListener("hd:scan-preview", handlePreview);
    window.addEventListener("hd:scan-preview-stop", handlePreviewStop);
    return () => {
      window.removeEventListener("hd:scan-preview", handlePreview);
      window.removeEventListener("hd:scan-preview-stop", handlePreviewStop);
      handlePreviewStop();
    };
  }, []);

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

  // Startup sound on first interaction
  useEffect(() => {
    const handler = () => {
      playStartupSound();
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("click", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  // On mount, load last-played episode and restore queue
  useEffect(() => {
    // Continue listening is now handled by ContinueListening on the library page

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

  // handleResume/handleDismissContinue removed — ContinueListening handles this

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

      // Radio dial page has its own keyboard handler
      if (pathname === "/radio") return;

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
          if (e.shiftKey) {
            // ? key = show shortcuts
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("hd:toggle-shortcuts"));
          } else {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("hd:focus-search"));
          }
          break;
        case "KeyF":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("hd:focus-search"));
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek, position, volume, setVolume, playNext, playPrevious, pathname]);

  // Episode count for status bar — handled via DesktopShell's episodeCount prop
  const episodeCount = useLiveQuery(() => db.episodes.count(), []);

  return (
    <DBErrorBoundary>
      <div data-hydrated="">
      <DesktopShell
        player={
<AudioPlayer />
        }
        episodeCount={episodeCount ?? 0}
      >
        {children}
      </DesktopShell>
      </div>
    </DBErrorBoundary>
  );
}
