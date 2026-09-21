"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { DesktopShell } from "@/components/desktop/DesktopShell";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { PlaybackErrorDialog } from "@/components/player/PlaybackErrorDialog";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { db, getPreference, setPreference } from "@/db";
import type { Episode } from "@/db/schema";
import { getCachedAudio, cacheAudioBlob } from "@/audio/cache";
import { seedLibraryIfEmpty, reconcileLibrary } from "@/db/seed";
import { DBErrorBoundary } from "@/components/DBErrorBoundary";
import { MilestoneDialog } from "@/components/desktop/MilestoneDialog";
import { playStartupSound } from "@/audio/startup-sound";
import { createScanPreview } from "@/audio/scan-preview";
import { beginStart, isCurrentStart } from "@/audio/play-session";
import { toast } from "@/stores/toast-store";
import { emit, onHdEvent, SW_OFFLINE_FALLBACK } from "@/lib/events";
import { isKeyOwnedByTarget } from "@/lib/utils/key-ownership";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { playEpisode, primeEpisode, togglePlay, seek, playNext, playPrevious } = useAudioPlayer();
  // NOT subscribed: reading position here would re-render the entire desktop
  // shell 4x/second during playback. The keyboard handler reads it on demand.
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const enqueue = usePlayerStore((s) => s.enqueue);
  // Continue listening is now handled by ContinueListening on the library page

  // Restore persisted admin state after mount (not during render — see admin-store),
  // then handle ?viewer URL param (logout only — login requires password)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("viewer")) {
      useAdminStore.getState().logout();
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    useAdminStore.getState().hydrate();
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
    const handler = async (episode: Episode) => {
      // This is the start. Everything below may await (a metadata fetch, an
      // OPFS read, a file picker), and the listener may pick another show in
      // the meantime; each continuation checks it is still the newest start
      // before going on, and playEpisode checks again (HD-003).
      const start = beginStart();

      // Also enqueue so manually-played episodes enter the queue
      enqueue(episode);

      // Archive episodes stream directly — no file picker needed
      if (episode.sourceUrl) {
        try {
          await playEpisode(episode, undefined, start);
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
            // Fetch metadata to find the best audio file (10s timeout)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`/api/archive/metadata?id=${encodeURIComponent(identifier)}`, { signal: controller.signal });
            clearTimeout(timeout);
            if (!isCurrentStart(start)) return;
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
              db.episodes.update(episode.id, { sourceUrl: episode.sourceUrl }).catch((err) => { console.warn("[layout] Failed to persist sourceUrl:", err); });
            }
            await playEpisode(episode, undefined, start);
            return;
          }
        } catch (err) {
          if (!isCurrentStart(start)) return;
          console.error("[layout] Failed to resolve archive URL:", err);
          toast.error("Couldn't reach archive.org. Check your connection.");
        }
      }

      // For local files, check OPFS cache first
      try {
        const cached = await getCachedAudio(episode.fileHash);
        if (!isCurrentStart(start)) return;
        if (cached) {
          await playEpisode(episode, new File([cached], episode.fileName, { type: "audio/mpeg" }), start);
          return;
        }
      } catch {
        // OPFS not available, fall through to file picker
      }
      if (!isCurrentStart(start)) return;

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

        if (file && isCurrentStart(start)) {
          await playEpisode(episode, file, start);
          // Cache to OPFS in background after playback starts
          cacheAudioBlob(episode.fileHash, file).catch((err) => {
            console.warn("[layout] OPFS cache failed:", err);
          });
        }
      } catch (err) {
        console.error("[layout] Failed to play episode:", err);
      }
    };

    return onHdEvent("play-episode", handler);
  }, [playEpisode, enqueue]);

  // Scan preview: brief audio snippet during radio scan. The element, its
  // timers and the never-`src = ""` reset live in src/audio/scan-preview.ts.
  useEffect(() => {
    const preview = createScanPreview();

    const handlePreview = (episode: Episode) => {
      // Don't preview if main player is playing
      if (usePlayerStore.getState().playing) return;
      void preview.start(episode);
    };
    const handlePreviewStop = () => preview.stop();

    // Stop preview when main player starts playing
    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      if (state.playing && !prev.playing) {
        preview.stop();
      }
    });

    const offPreview = onHdEvent("scan-preview", handlePreview);
    const offPreviewStop = onHdEvent("scan-preview-stop", handlePreviewStop);
    return () => {
      unsubscribe();
      offPreview();
      offPreviewStop();
      preview.stop();
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
        }).catch((err) => { console.warn("[layout] Failed to record history:", err); });
      }
      // Persist queue when it changes
      if (state.queue !== prevState.queue || state.queueIndex !== prevState.queueIndex) {
        const queueIds = state.queue.map((e) => e.id).filter(Boolean);
        setPreference("queue-ids", JSON.stringify(queueIds));
        setPreference("queue-index", String(state.queueIndex));
      }
    });
  }, []);

  // On mount, seed the library if empty. Otherwise restore any catalog episodes that
  // are missing — a previous dedup bug deleted up to 1,312 of 1,313 for some users.
  // Reconcile only ever ADDS rows that don't exist locally, so user data is untouched.
  // Deferred to idle so a large bulkAdd doesn't compete with first paint.
  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      seedLibraryIfEmpty()
        .then(async (seeded) => {
          if (seeded || cancelled) return;
          const restored = await reconcileLibrary();
          if (restored > 0 && !cancelled) {
            toast.success(`Restored ${restored.toLocaleString()} missing episodes to your library`);
          }
        })
        .catch((err) => { console.warn("[layout] Seed/reconcile failed:", err); })
        .finally(() => {
          // Tell the library it may now trust an empty table. Seeding is
          // deferred to idle but Dexie's live query resolves immediately, so
          // without this every first-time visitor was shown "No episodes in
          // the library yet… try refreshing" — a failure message, on success.
          emit("seed-settled");
        });
    };

    // requestIdleCallback is missing on older Safari — fall back to a timeout.
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle
      ? window.requestIdleCallback(run)
      : window.setTimeout(run, 1000);

    return () => {
      cancelled = true;
      if (idle && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, []);

  // Service-worker fallback notice.
  //
  // The `offline` and `online` window events are deliberately NOT handled here.
  // <OfflineIndicator> already renders a persistent, aria-live banner for
  // exactly those two events, so firing a toast as well meant going offline
  // produced a banner and a toast saying the same thing at the same moment. A
  // persistent state deserves a persistent indicator, not a transient toast.
  useEffect(() => {
    const onSWMessage = (e: MessageEvent) => {
      if (e.data?.type === SW_OFFLINE_FALLBACK) {
        toast.info("Showing cached content — you may be offline.");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
    };
  }, []);

  // Startup sound on first interaction
  useEffect(() => {
    const handler = () => {
      try {
        playStartupSound();
      } catch {
        // AudioContext may be blocked — not critical
      }
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

  // On mount, restore queue and silently load last-played episode into player
  useEffect(() => {
    Promise.all([
      getPreference("queue-ids"),
      getPreference("queue-index"),
      getPreference("last-episode-id"),
    ]).then(async ([idsJson, indexStr, lastIdStr]) => {
      // Restore queue
      if (idsJson) {
        try {
          const ids: number[] = JSON.parse(idsJson);
          if (Array.isArray(ids) && ids.length > 0) {
            const episodes = await db.episodes.where("id").anyOf(ids).toArray();
            const byId = new Map(episodes.map((e) => [e.id, e]));
            const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Episode[];
            if (ordered.length > 0) {
              const idx = parseInt(indexStr ?? "-1", 10);
              usePlayerStore.getState().restoreQueue(
                ordered,
                Math.min(Math.max(idx, -1), ordered.length - 1),
              );
            }
          }
        } catch {
          // Ignore corrupt queue data
        }
      }

      // Silently load last episode into player (no auto-play)
      if (lastIdStr && !usePlayerStore.getState().currentEpisode) {
        const id = parseInt(lastIdStr, 10);
        if (!isNaN(id)) {
          const ep = await db.episodes.get(id);
          if (ep) {
            usePlayerStore.getState().loadEpisode(ep, "");
            usePlayerStore.getState().setPosition(ep.playbackPosition ?? 0);
            usePlayerStore.getState().setDuration(ep.duration ?? 0);
            // Point the element at it too. loadEpisode only touches the store,
            // so without this the restored player rendered a live ▶ over an
            // element with no source and the button did nothing at all — the
            // whole reported bug. Deliberately still no auto-play; priming
            // fetches no audio under preload="metadata".
            primeEpisode(ep);
          }
        }
      }
    });
    // primeEpisode is stable (its only dep, getAudio, is []-memoized), so this
    // still runs exactly once on mount.
  }, [primeEpisode]);

  // handleResume/handleDismissContinue removed — ContinueListening handles this

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs, or when focus is on a control
      // that owns the key itself. Buttons were missing here, so tabbing to any
      // button and pressing Space toggled playback instead of activating it —
      // which broke every button in the app for keyboard users. The guard is
      // shared with the library and radio handlers (HD-011).
      if (isKeyOwnedByTarget(e)) return;

      // Radio dial page has its own keyboard handler
      if (pathname === "/radio") return;

      // Easter egg: Ctrl+Shift+A → Area 51 signal drop
      if (e.code === "KeyA" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        emit("easter-egg", "area51");
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(usePlayerStore.getState().position - 15);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(usePlayerStore.getState().position + 30);
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
          // ? = show shortcuts. `/`, Ctrl/Cmd+F and Q are the library's, and
          // only registered while it is mounted (useLibrarySearchShortcuts):
          // handled here they were preventDefault-ed on every route, which
          // disabled the browser's find on /stats and /scanner (HD-013).
          if (e.shiftKey) {
            e.preventDefault();
            emit("toggle-shortcuts");
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek, volume, setVolume, playNext, playPrevious, pathname]);

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
      <MilestoneDialog />
      {/* Mounted here rather than inside AudioPlayer so a failure is still
          announced on pages that render no player chrome. */}
      <PlaybackErrorDialog />
      </div>
    </DBErrorBoundary>
  );
}
