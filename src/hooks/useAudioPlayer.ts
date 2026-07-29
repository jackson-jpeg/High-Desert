"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import {
  initEngine,
  setEngineVolume,
  resumeContext,
  getMediaElement,
  notifySourceChanged,
} from "@/audio/engine";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { reportPlay, reportStop, reportStopBeacon } from "@/services/stats/client";
import { SESSION_ID } from "@/lib/utils/session-id";
import { communityKey } from "@/lib/utils/community-key";
import { checkArchiveHealth, clearHealthCache } from "@/services/archive/health";
import {
  armWatchdog,
  disarmWatchdog,
  isWatching,
  noteError,
  noteProgress,
  noteReady,
  noteUnplayable,
  noteWaiting,
  setFailureHandler,
} from "@/audio/playback-watchdog";
import { assessDuration } from "@/audio/duration-sanity";

// ── Listening session tracking ──
//
// This used to carry a `_listenAccum` seconds counter alongside these calls.
// Its only reader was the umami analytics call, removed when the site dropped
// third-party scripts, so it had been accumulated and reset on every play,
// pause, seek and unload while nothing ever read it. Deleted deliberately, as
// the note left here asked: per-episode listened time is already derived from
// `playbackPosition` in IndexedDB, and community totals now come from the
// self-hosted stats service.
//
// What remains is the session lifecycle, which is load-bearing: it drives
// reportStop(), and therefore the community listening count.
const _sessionId = SESSION_ID;

/**
 * @param reason `pause` keeps the session marked as listening — a brief pause
 * is not leaving. `ended`/`stop`/`unload` clear it.
 */
function flushListenTime(reason: "pause" | "ended" | "unload" | "stop") {
  if (reason === "ended" || reason === "unload" || reason === "stop") {
    reportStop(_sessionId);
  }
}

// ── Single-owner globals ──
//
// This hook is instantiated twice: once by the desktop layout and once by
// <AudioPlayer/>, whose `if (!currentEpisode) return null` sits *after* the
// hooks, so it always runs them. Both instances share one HTMLAudioElement via
// the engine, so every media listener, timer and interval below was installed
// twice. The visible symptom was the queue advancing by two at the end of a
// track — two `ended` handlers each calling next() — plus a doubled position
// tick, a doubled persist interval and two reportStop() calls per unload.
//
// Ref-counted rather than claimed-by-first-mount: the count survives one
// instance unmounting, and React StrictMode's double-invoke (1→2→1) is a no-op.
let globalRefs = 0;
let releaseGlobals: (() => void) | null = null;

function withGlobals(install: () => () => void): () => void {
  globalRefs++;
  if (globalRefs === 1) releaseGlobals = install();
  return () => {
    globalRefs--;
    if (globalRefs === 0) {
      releaseGlobals?.();
      releaseGlobals = null;
    }
  };
}

/**
 * When each episode's play was last counted, for retry de-duplication.
 *
 * Pressing Retry is the same listen, not a second one, and a flaky stream
 * inflated both the local playCount and the community leaderboard every time
 * someone tried again. A time window rather than a once-per-page-load set:
 * retries happen within seconds, but genuinely putting a show back on an hour
 * later is a real second listen and should count as one.
 */
const lastCounted = new Map<string, number>();
const COUNT_DEDUP_MS = 120_000;

function shouldCountPlay(key: string): boolean {
  const now = Date.now();
  const prev = lastCounted.get(key);
  if (prev != null && now - prev < COUNT_DEDUP_MS) return false;
  lastCounted.set(key, now);
  return true;
}

// ── Starting a listen ──
//
// There are two ways playback starts and they had drifted apart. `playEpisode()`
// is the obvious one — library click, queue advance, radio dial. The other is
// `togglePlay()` resuming an episode that `primeEpisode()` pointed the element
// at on restore: it plays the element in place and never goes near playEpisode.
//
// Every side effect playEpisode accumulated over time was therefore missing from
// the restored player, silently, one at a time. The one that mattered was the
// play report — a listen started from the remembered show wrote no leaderboard
// entry, no permanent event and no `active_sessions.episode_id`, so it never
// appeared on air while it was audibly playing.
//
// The three functions below are the whole of what starting a listen means, and
// both paths call all three. Adding a side effect to one caller instead of to
// these is how the next one goes missing.
//
//   openListen  — before the source is assigned
//   armListen   — after it is, once there is something to watch
//   countListen — after play() resolves, so a rejected play counts as nothing

/**
 * Clear what the last attempt left behind and establish queue context.
 *
 * `setError(null)`: a failure banner from a previous show must not outlive the
 * decision to play a new one. `clearHealthCache()`: the archive.org outage
 * verdict is about to be re-tested by an actual request, so the cached one is
 * stale by definition. `loadEpisode`: makes this episode the current one and
 * puts it in the queue — the restore path in (desktop)/layout.tsx does this
 * already, but the invariant belongs to starting a listen rather than to one
 * caller happening to have run first.
 */
function openListen(episode: Episode, objectUrl: string): void {
  const store = usePlayerStore.getState();
  store.setError(null);
  clearHealthCache();
  // Skip when nothing would change: loadEpisode resets position and duration
  // from the episode record, and re-running it mid-listen would throw away a
  // seek. Cheap identity check rather than a flag any caller could forget.
  if (store.currentEpisode?.id !== episode.id || store.queueIndex < 0) {
    store.loadEpisode(episode, objectUrl);
  }
}

/**
 * Hand the attempt to the watchdog. Must follow the source assignment — there
 * is nothing to time out until the element has been pointed at something.
 */
function armListen(
  episode: Episode | null,
  audio: HTMLAudioElement,
  startAt: number,
): void {
  usePlayerStore.getState().setLoadState("loading");
  armWatchdog({
    audio,
    url: audio.src,
    episodeId: episode ? communityKey(episode) : null,
    startAt,
  });
}

/**
 * A listen has begun: tell the community stats and bump the local play count.
 *
 * Whether the play is *counted* stays with shouldCountPlay; this is only about
 * there being a call site on both paths.
 */
function countListen(episode: Episode): void {
  const key = communityKey(episode);
  if (!shouldCountPlay(key ?? `local:${episode.fileHash}`)) return;

  if (key) reportPlay(key, _sessionId);
  if (episode.id) {
    db.episodes
      .update(episode.id, {
        playCount: (episode.playCount ?? 0) + 1,
        lastPlayedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .catch((err) => {
        console.warn("[player] Failed to update play count:", err);
      });
  }
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const positionTimerRef = useRef<number>(0);

  // Individual selectors, NOT `usePlayerStore()`. Subscribing to the whole store
  // meant the 250ms position tick re-rendered this hook's consumers — including
  // the desktop layout and the entire app shell — four times a second for the
  // whole duration of playback. `position` is deliberately not subscribed here;
  // components that display it (AudioPlayer) select it themselves.
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const objectUrl = usePlayerStore((s) => s.objectUrl);
  const playing = usePlayerStore((s) => s.playing);
  const volume = usePlayerStore((s) => s.volume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const error = usePlayerStore((s) => s.error);
  // Actions have stable identities, so selecting them never triggers a render.
  // loadEpisode is deliberately not among them: it belongs to openListen now,
  // so that starting a listen is one call rather than a list of steps each
  // caller is trusted to remember.
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const setPosition = usePlayerStore((s) => s.setPosition);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setError = usePlayerStore((s) => s.setError);
  const stop = usePlayerStore((s) => s.stop);

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

  /**
   * Point the element at an episode without playing it.
   *
   * This is the fix for the reported bug. Restoring the last-played episode on
   * revisit called only `loadEpisode()` — a pure Zustand setter that never
   * touches the media element. So the player rendered with a live ▶ button over
   * an element whose `src` was still empty, and `togglePlay` returned at its
   * `if (!audio.src)` guard: no sound, no error, no log. The listener saw a
   * dead button and reasonably concluded they had done something wrong.
   *
   * Drops `preload` to "none" first, so this costs no network at all. Leaving
   * it at "metadata" would have every page load fetch the head of a show
   * nobody has asked for yet — and for a VBR rip with no Xing header, working
   * out the duration can mean scanning a large part of the file. The catalog
   * is full of those, and the bill lands on archive.org and on whatever mobile
   * data the listener is paying for. `play()` loads regardless of preload, so
   * the button still works.
   */
  const primeEpisode = useCallback(
    (episode: Episode) => {
      if (!episode.sourceUrl) return;
      const audio = getAudio();
      if (audio.src) return; // something is already loaded; don't stomp it
      notifySourceChanged();
      audio.preload = "none";
      audio.src = episode.sourceUrl;
      audio.currentTime = episode.playbackPosition ?? 0;
      audio.playbackRate = usePlayerStore.getState().playbackRate;
    },
    [getAudio],
  );

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

      openListen(episode, isObjectUrl ? url : "");
      notifySourceChanged();

      // Reset before re-assigning: a stale src plus load() is its own source of
      // hangs, and `src = ""` would make the browser fetch the HTML document
      // and try to decode it as audio.
      audio.removeAttribute("src");
      audio.load();
      // Back up from whatever primeEpisode left it at — we want this one.
      audio.preload = "metadata";
      audio.src = url;
      audio.currentTime = episode.playbackPosition ?? 0;
      audio.playbackRate = usePlayerStore.getState().playbackRate;

      armListen(episode, audio, episode.playbackPosition ?? 0);

      try {
        // play() first, resumeContext() after. The analyser context is not
        // required for playback (see engine.ts) and awaiting it here put a
        // real task boundary between the user's tap and play(), which is how
        // Safari decides a call was not user-initiated.
        await audio.play();
        resumeContext().catch(() => {});
        setPlaying(true);

        // Count the listen, unless this is a retry of one just counted.
        countListen(episode);
      } catch (err) {
        console.error("[player] Playback failed:", err);
        // Hand it to the watchdog, which owns the one-retry-then-fail policy.
        // Only fall back to the banner if there was no attempt to hand it to.
        if (isWatching()) {
          noteError("play-rejected");
        } else {
          usePlayerStore.getState().setLoadState("failed");
          setError("Playback failed. The audio source may be unavailable.");
        }
        if (isObjectUrl) URL.revokeObjectURL(url);
      }
    },
    [getAudio, setPlaying, setError],
  );

  // Play/pause toggle
  const togglePlay = useCallback(async () => {
    const audio = getAudio();

    // No source, but an episode is loaded — this is the restored-episode case.
    // Route through the normal play path rather than dead-ending. Dispatching
    // is synchronous and the seeded fast path reaches play() without an
    // intervening task, so the user's gesture is still in hand.
    if (!audio.src) {
      const { currentEpisode: ep } = usePlayerStore.getState();
      if (ep) {
        window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: ep }));
      }
      return;
    }

    if (playing) {
      audio.pause();
      setPlaying(false);
      flushListenTime("pause");
      resumeContext().catch(() => {});
    } else {
      const { currentEpisode: ep } = usePlayerStore.getState();

      // A primed-but-never-loaded element has a src and readyState 0, so this
      // is the restored episode's first play. It needs the same watchdog cover
      // as a fresh one — it is the exact case the listener was hitting, and
      // starting it unguarded would swap a silent dead button for a silent
      // infinite spinner.
      //
      // It is also a *listen starting*, which is the part this branch used to
      // miss: unlike every other start path it never touches playEpisode, so
      // nothing reported the play. Distinguished from an ordinary pause/resume,
      // which is the same listen continuing and must not be counted again.
      const firstPlay =
        audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !isWatching();

      if (firstPlay) {
        // Undo primeEpisode's "none" so the element actually buffers ahead.
        audio.preload = "metadata";
        // The source is already assigned, so openListen runs against it rather
        // than before it — the only ordering difference between the two paths.
        if (ep) openListen(ep, usePlayerStore.getState().objectUrl ?? "");
        armListen(ep, audio, audio.currentTime);
      }

      try {
        await audio.play();
        resumeContext().catch(() => {});
        setPlaying(true);
        if (firstPlay && ep) countListen(ep);
      } catch (err) {
        console.error("[player] Play failed:", err);
        // This catch used to swallow the rejection entirely, so a refused
        // resume left the UI paused with no explanation whatsoever.
        if (isWatching()) {
          noteError("play-rejected");
        } else {
          setError("Couldn't resume playback. Try again.");
        }
      }
    }
  }, [getAudio, playing, setPlaying, setError]);

  // Seek to a position in seconds
  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio();
      // A restored episode has a duration in the store but nothing loaded in
      // the element, so scrubbing was silently dead too. Record the intent —
      // playEpisode seeks to playbackPosition when it loads.
      if (!audio.src) {
        const { currentEpisode: ep, duration: storeDuration } =
          usePlayerStore.getState();
        if (ep && storeDuration > 0) {
          const clamped = Math.max(0, Math.min(seconds, storeDuration));
          ep.playbackPosition = clamped;
          setPosition(clamped);
        }
        return;
      }
      if (!audio.duration || !isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
      setPosition(audio.currentTime);
    },
    [getAudio, setPosition],
  );

  // Stop playback
  const stopPlayback = useCallback(() => {
    flushListenTime("stop");
    disarmWatchdog();
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
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

  // Position tracking timer.
  //
  // Driven by a store subscription rather than a `playing` dependency so the
  // effect itself can be mount-once and therefore single-owner. Keyed off
  // `playing` the effect re-ran on every play/pause, which meant the ref count
  // never fell to zero and both hook instances kept a 250ms timer alive.
  useEffect(() => {
    return withGlobals(() => {
      const start = () => {
        if (positionTimerRef.current) return;
        positionTimerRef.current = window.setInterval(() => {
          const audio = getMediaElement();
          if (audio && !audio.paused) {
            usePlayerStore.getState().setPosition(audio.currentTime);
          }
        }, 250);
      };
      const stopTimer = () => {
        window.clearInterval(positionTimerRef.current);
        positionTimerRef.current = 0;
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
    });
  }, []);

  // Listen for audio ended + errors. Installed once — see withGlobals.
  useEffect(() => {
    const audio = getAudio();
    return withGlobals(() => {

    /**
     * The file is not a broadcast. Stop, and say so.
     *
     * Routed through the watchdog when a load attempt is outstanding so the
     * failure is reported with the same shape as every other one; when it is
     * not (an `ended` that arrives long after the load settled) the load state
     * is set directly, which is what raises PlaybackErrorDialog.
     */
    const failUnplayable = () => {
      audio.pause();
      setPlaying(false);
      if (isWatching()) {
        noteUnplayable("empty-media");
      } else {
        usePlayerStore.getState().setLoadState("failed", "empty-media");
      }
    };

    const onEnded = () => {
      // A show that "ended" without ever really starting is the last shape of
      // the reported bug: archive.org serves the file with a clean 206, the
      // element plays a few seconds of nothing and reports itself finished.
      // Advancing the queue here would hide it — the listener would see the
      // next show start and conclude they had mis-clicked. Again.
      const unplayable =
        assessDuration({
          actual: audio.duration,
          expected: usePlayerStore.getState().currentEpisode?.duration ?? null,
          stage: "ended",
        }) !== "ok";

      flushListenTime("ended");

      if (unplayable) {
        failUnplayable();
        return;
      }

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
    const onLoadedMetadata = () => {
      setDuration(audio.duration);

      // Only the absolute floor is judged here. For a VBR rip with no Xing
      // header — most of this catalog — `duration` at this point is
      // extrapolated from the first frame and gets corrected later, so the
      // "shorter than catalogued" comparison waits for `ended`. Nothing that
      // reports under five seconds is a broadcast, however it was measured.
      if (
        assessDuration({
          actual: audio.duration,
          expected: usePlayerStore.getState().currentEpisode?.duration ?? null,
          stage: "metadata",
        }) !== "ok"
      ) {
        failUnplayable();
      }
    };
    const onError = () => {
      setPlaying(false);
      const code = audio.error?.code;

      // While a load attempt is outstanding the watchdog owns the response:
      // it spends the retry, and only surfaces anything if that also fails.
      // Errors outside a load attempt (mid-playback) still go straight to the
      // banner, which is the right weight for a transient interruption.
      if (isWatching()) {
        noteError(code === 3 ? "decode-error" : "network-error");
      } else {
        const messages: Record<number, string> = {
          1: "Playback aborted.",
          2: "Network error. Check your connection.",
          3: "Audio decoding failed.",
          4: "Audio source not supported or unavailable.",
        };
        setError(messages[code ?? 0] ?? "An unknown playback error occurred.");
      }

      // On network/source errors, check if archive.org itself is down
      if (code === 2 || code === 4) {
        checkArchiveHealth().then(({ up }) => {
          if (!up) {
            window.dispatchEvent(new CustomEvent("hd:archive-status", { detail: { up: false } }));
          }
        });
      }
    };

    // Sync store when iOS/lock screen controls trigger play/pause directly
    const onPlay = () => {
      if (!usePlayerStore.getState().playing) setPlaying(true);
    };
    const onPause = () => {
      if (usePlayerStore.getState().playing) setPlaying(false);
    };

    const { setBuffering, setLoadState, setBufferedTo } =
      usePlayerStore.getState();

    const onWaiting = () => {
      setBuffering(true);
      noteWaiting();
    };
    const ready = () => {
      setBuffering(false);
      noteReady();
      setLoadState("playing");
    };
    const onCanPlay = ready;
    const onPlaying = ready;

    // `progress` is the only positive evidence that a slow load is still
    // moving. Without it a download crawling in at 20KB/s was indistinguishable
    // from one that had died, and both looked like a frozen ▶.
    const onProgress = () => {
      noteProgress();
      try {
        const { buffered, currentTime } = audio;
        for (let i = 0; i < buffered.length; i++) {
          if (buffered.start(i) <= currentTime + 0.5) {
            setBufferedTo(buffered.end(i));
          }
        }
      } catch {
        // buffered throws on some elements before metadata; not worth guarding
      }
    };

    // Neither of these was listened for. A connection that hangs mid-handshake
    // fires `stalled` and then nothing at all — no error ever arrives.
    const onStalled = () => noteWaiting();
    const onSuspend = () => {
      // Benign at the end of a load; only meaningful while still waiting.
      if (audio.readyState < 3) noteWaiting();
    };
    const onAbort = () => {
      setBuffering(false);
      if (isWatching()) noteError("network-error");
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);
    audio.addEventListener("abort", onAbort);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
      audio.removeEventListener("abort", onAbort);
    };
    });
  }, [getAudio, setPlaying, setDuration, setError]);

  // The watchdog reports terminal failures here — the retry is already spent,
  // so this is what raises the modal.
  useEffect(() => {
    return withGlobals(() => {
      setFailureHandler((kind) => {
        const { setLoadState: setLS, setBuffering: setBuf, setError: setErr } =
          usePlayerStore.getState();
        setBuf(false);
        setPlaying(false);
        setLS("failed", kind);
        setErr(
          kind === "empty-media"
            ? "This recording has no audio in it."
            : kind === "decode-error"
              ? "This recording could not be decoded."
              : "This broadcast isn't coming through.",
        );
      });
      return () => setFailureHandler(() => {});
    });
  }, [setPlaying]);

  // Persist playback position periodically. Mount-once for the same reason as
  // the position timer — otherwise both instances wrote the same row every 5s.
  useEffect(() => {
    return withGlobals(() => {
      let interval = 0;
      const start = () => {
        if (interval) return;
        interval = window.setInterval(async () => {
          const { position: pos, currentEpisode: ep } = usePlayerStore.getState();
          if (ep?.id) {
            await db.episodes.update(ep.id, {
              playbackPosition: pos,
              lastPlayedAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }, 5000);
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
        sync(s.playing, s.currentEpisode?.id);
      });

      return () => {
        unsub();
        stopTimer();
      };
    });
  }, []);

  // Flush position + listen time on page unload
  useEffect(() => {
    return withGlobals(() => {
    const flush = () => {
      flushListenTime("unload");
      reportStopBeacon(_sessionId);
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
          req.onerror = () => {}; // best-effort — position was saved within 5s interval
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
    });
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

  // Update MediaSession position state on a timer rather than on every position
  // change — reading from getState() keeps this off the render path entirely.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!currentEpisode || !playing) return;

    const push = () => {
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
    };

    push();
    const id = window.setInterval(push, 5000);
    return () => window.clearInterval(id);
  }, [currentEpisode, playing]);

  return {
    playEpisode,
    primeEpisode,
    togglePlay,
    seek,
    stopPlayback,
    playNext,
    playPrevious,
    audioRef,
    currentEpisode,
    objectUrl,
    playing,
    volume,
    playbackRate,
    error,
  };
}
