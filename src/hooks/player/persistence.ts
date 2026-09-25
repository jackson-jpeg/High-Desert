// Where the listener is, kept: the 250 ms position tick, the periodic and
// on-pause position save, and the unload flush (position + the stop beacon).
// Each install runs once, under its own GlobalKey (./globals.ts) — useAudioPlayer
// is mounted twice, and both instances used to write the same row every tick.

import { usePlayerStore } from "@/stores/player-store";
import { getMediaElement } from "@/audio/engine";
import { db } from "@/db";
import { reportStopBeacon } from "@/services/stats/client";
import { noteListenTick, breakListenTick, flushListenSeconds } from "@/services/episodes/listen-time";
import { PLAYER_SESSION_ID, flushListenTime } from "./play-session";

/**
 * How often position is written while playing. Every write re-runs the live
 * queries over the whole episodes table (library facets, smart playlists, stats)
 * so at 5 s a three-hour show cost ~2,000 full rebuilds (HD-016). 30 s, plus a
 * save on pause, on `visibilitychange` and on `pagehide`, loses at most 30 s on
 * a crash and nothing on any ordinary exit.
 */
export const POSITION_SAVE_MS = 30_000;

/** Write the current episode's position. Never throws — see the catch. */
function savePosition(): void {
  const { position: pos, currentEpisode: ep } = usePlayerStore.getState();
  if (!ep?.id) return;
  void flushListenSeconds(ep.id);
  db.episodes
    .update(ep.id, {
      playbackPosition: pos,
      lastPlayedAt: Date.now(),
      updatedAt: Date.now(),
    })
    // This ran inside a setInterval with no catch: a failed write (quota, a
    // closed database, a blocked upgrade) was an unhandled rejection on every
    // tick for the rest of the show (HD-032).
    .catch((err) => {
      console.warn("[player] Failed to save position:", err);
    });
}

/**
 * Position tracking timer — the store's `position` and the listened-time tick.
 *
 * Driven by a store subscription rather than a `playing` dependency so the
 * effect itself can be mount-once and therefore single-owner. Keyed off
 * `playing` the effect re-ran on every play/pause, which meant the ref count
 * never fell to zero and both hook instances kept a 250ms timer alive.
 */
export function installPositionTimer(): () => void {
  let timer = 0;
  const start = () => {
    if (timer) return;
    timer = window.setInterval(() => {
      const audio = getMediaElement();
      if (audio && !audio.paused) {
        usePlayerStore.getState().setPosition(audio.currentTime);
        noteListenTick(audio.currentTime);
      }
    }, 250);
  };
  const stopTimer = () => {
    window.clearInterval(timer);
    timer = 0;
    breakListenTick();
  };

  if (usePlayerStore.getState().playing) start();
  const unsub = usePlayerStore.subscribe((s, prev) => {
    if (s.playing === prev.playing) return;
    if (s.playing) start();
    else stopTimer();
  });

  return () => {
    unsub();
    stopTimer();
  };
}

/**
 * Persist playback position: every POSITION_SAVE_MS while playing, and at once
 * on pause. Mount-once for the same reason as the position timer — otherwise
 * both instances wrote the same row on every interval.
 */
export function installPositionPersistence(): () => void {
  let interval = 0;
  const start = () => {
    if (interval) return;
    interval = window.setInterval(savePosition, POSITION_SAVE_MS);
  };
  const stopTimer = () => {
    window.clearInterval(interval);
    interval = 0;
  };

  const sync = (playingNow: boolean, epId: number | undefined) => {
    if (playingNow && epId) start();
    else stopTimer();
  };

  const s0 = usePlayerStore.getState();
  sync(s0.playing, s0.currentEpisode?.id);
  const unsub = usePlayerStore.subscribe((s, prev) => {
    if (s.playing === prev.playing && s.currentEpisode?.id === prev.currentEpisode?.id) return;
    // Changed episode: what was heard belongs to the one that was playing.
    if (s.currentEpisode?.id !== prev.currentEpisode?.id) {
      breakListenTick();
      void flushListenSeconds(prev.currentEpisode?.id);
    }
    // Paused (the same episode, no longer playing): save now. With a 30 s
    // interval, waiting for the next tick would lose the pause position to
    // anything that ends the page before then.
    if (
      prev.playing &&
      !s.playing &&
      s.currentEpisode?.id !== undefined &&
      s.currentEpisode.id === prev.currentEpisode?.id
    ) {
      savePosition();
    }
    sync(s.playing, s.currentEpisode?.id);
  });

  return () => {
    unsub();
    stopTimer();
  };
}

/** Flush position + listen time on page unload. */
export function installUnloadFlush(): () => void {
  const flush = () => {
    flushListenTime("unload");
    reportStopBeacon(PLAYER_SESSION_ID);
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
          getReq.onerror = () => {}; // best-effort
        };
        req.onerror = () => {}; // best-effort — the interval saved within 30s
      } catch {
        // Best-effort — if IDB fails during unload, the interval saved within 30s
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
}
