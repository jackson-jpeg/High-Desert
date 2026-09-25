"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import {
  initEngine,
  setEngineVolume,
  resumeContext,
  getMediaElement,
  notifySourceChanged,
  seekEngine,
} from "@/audio/engine";
import {
  beginStart,
  currentStart,
  isAbortError,
  isCurrentStart,
  isListenCounted,
  markListenCounted,
  startPositionFor,
} from "@/audio/play-session";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { reportPlay, reportStop, reportStopBeacon } from "@/services/stats/client";
import { SESSION_ID } from "@/lib/utils/session-id";
import { communityKey } from "@/lib/utils/community-key";
import { checkArchiveHealth, archiveKnownDown } from "@/services/archive/health";
import { fallbacksFor, type SourceKind } from "@/audio/sources";
import { currentStartPlan, refuseIfUnavailable } from "@/audio/outage-gate";
import {
  armWatchdog,
  describeMediaError,
  disarmWatchdog,
  isWatching,
  noteError,
  noteListenersAttached,
  noteListenersDetached,
  noteProgress,
  noteReady,
  noteSuspectDuration,
  noteUnplayable,
  noteWaiting,
  setFailureHandler,
  setFailoverHandler,
} from "@/audio/playback-watchdog";
import { assessDuration } from "@/audio/duration-sanity";
import { noteListenTick, breakListenTick, flushListenSeconds } from "@/services/episodes/listen-time";
import { emit } from "@/lib/events";

// ── Listening session tracking ──
//
// This used to carry a `_listenAccum` seconds counter alongside these calls.
// Its only reader was the umami analytics call, removed when the site dropped
// third-party scripts, so it had been accumulated and reset on every play,
// pause, seek and unload while nothing ever read it. Deleted deliberately, as
// the note left here asked. (The belief that listened time could be derived
// from `playbackPosition` was wrong — see src/services/episodes/listen-time.ts,
// which now measures it from the position tick.) Community totals come from
// the self-hosted stats service.
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
//
// The count is PER CALL SITE, which is the whole point and was the bug. A single
// shared counter meant `globalRefs === 1` was true for exactly one of the calls
// below — whichever ran first, i.e. the position timer — and the other four
// installs never ran at all. Not once, in any browser, since this was written.
// What that cost: the media element listeners were never attached, so the
// watchdog could see neither `progress` nor `canplay` and every load ran its
// deadline out and reported a phantom timeout over audio that was playing;
// `setFailureHandler` was never installed, so PlaybackErrorDialog could not
// open; playback position was never persisted; and the unload beacon never
// fired, so sessions accumulated in `active_sessions`.
//
// `releaseGlobals` was the same mistake twice: one variable for five cleanups,
// so even with a correct count a second install would have overwritten the
// first's teardown.
const globalRefs = new Map<string, number>();
const globalRelease = new Map<string, () => void>();

type GlobalKey =
  | "position-timer"
  | "media-events"
  | "failure-handler"
  | "failover-handler"
  | "persist-position"
  | "unload-flush";

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

function withGlobals(key: GlobalKey, install: () => () => void): () => void {
  const next = (globalRefs.get(key) ?? 0) + 1;
  globalRefs.set(key, next);
  if (next === 1) globalRelease.set(key, install());
  return () => {
    const remaining = (globalRefs.get(key) ?? 1) - 1;
    globalRefs.set(key, remaining);
    if (remaining === 0) {
      globalRelease.get(key)?.();
      globalRelease.delete(key);
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
 * decision to play a new one. (It also cleared the archive.org health verdict,
 * on the theory that the request about to be made would re-test it. With the
 * mirror, a fresh "down" verdict is what sends this start straight to the
 * mirror instead, so it must survive; it now expires by itself after 30 s —
 * src/services/archive/health.ts.) `loadEpisode`: makes this episode the current one and
 * puts it in the queue — the restore path in (desktop)/layout.tsx does this
 * already, but the invariant belongs to starting a listen rather than to one
 * caller happening to have run first.
 */
function openListen(episode: Episode, objectUrl: string): void {
  const store = usePlayerStore.getState();
  store.setError(null);
  // Skip when nothing would change: loadEpisode resets position and duration
  // from the episode record, and re-running it mid-listen would throw away a
  // seek. Cheap identity check rather than a flag any caller could forget.
  //
  // A new object URL for the same episode (Try Again with a re-picked file) is
  // the exception: the store must own it, or it is never revoked (HD-033).
  if (
    store.currentEpisode?.id !== episode.id ||
    store.queueIndex < 0 ||
    (objectUrl !== "" && objectUrl !== store.objectUrl)
  ) {
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
  const { setLoadState, source } = usePlayerStore.getState();
  setLoadState("loading");
  armWatchdog({
    audio,
    url: audio.src,
    episodeId: episode ? communityKey(episode) : null,
    startAt,
    source,
    // Where to go if this host stops delivering: the mirror, behind archive.org.
    fallbacks: episode ? fallbacksFor(episode, source) : [],
  });
}

/**
 * A listen has begun: tell the community stats and bump the local play count.
 *
 * Whether the play is *counted* stays with shouldCountPlay; this is only about
 * there being a call site on both paths.
 */
function countListen(episode: Episode, start: number): void {
  // This source's listen is counted, whatever the de-duplication below decides:
  // a pause/seek/resume of it is the same listen continuing.
  markListenCounted(start);
  const key = communityKey(episode);
  if (!shouldCountPlay(key ?? `local:${episode.fileHash}`)) return;

  if (key) reportPlay(key, _sessionId, usePlayerStore.getState().source);
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
      // A new source is a new start: its listen has not been counted.
      beginStart();
      notifySourceChanged();
      audio.preload = "none";
      audio.src = episode.sourceUrl;
      usePlayerStore.getState().setSource("archive");
      // readyState is 0 here, so this is held until loadedmetadata (engine.ts).
      seekEngine(startPositionFor(episode.playbackPosition, episode.duration));
      audio.playbackRate = usePlayerStore.getState().playbackRate;
    },
    [getAudio],
  );

  // Load and optionally play an episode.
  //
  // `start` is the id the caller took with beginStart() before any async work
  // of its own (the hd:play-episode handler resolves URLs and reads OPFS first).
  // Without one, this call is the start.
  const playEpisode = useCallback(
    async (episode: Episode, file?: File, start?: number) => {
      const id = start ?? beginStart();
      // Superseded before we got here — someone picked another show while the
      // caller was still resolving this one. Touch nothing.
      if (!isCurrentStart(id)) return;

      const audio = getAudio();

      // Object URL from a file (the OPFS cache, or a scanned local file), else
      // the first of the episode's hosts: archive.org, or the mirror while
      // archive.org is down (src/audio/sources.ts) — or, if the mirror's
      // manifest says it does not hold this show either, nothing: refuse now,
      // with the outage dialog, rather than after a 15 s wait for a 503.
      // Synchronous on purpose — nothing may be awaited before play().
      let url: string;
      let kind: SourceKind;
      let isObjectUrl = false;
      if (file) {
        url = URL.createObjectURL(file);
        isObjectUrl = true;
        kind = episode.fileHash?.startsWith("archive:") ? "cache" : "local";
      } else {
        if (refuseIfUnavailable(episode)) return;
        const plan = currentStartPlan(episode);
        if (plan.kind !== "play") {
          setError("No audio source available. Try re-importing this episode.");
          return;
        }
        url = plan.source.url;
        kind = plan.source.kind;
      }

      openListen(episode, isObjectUrl ? url : "");
      usePlayerStore.getState().setSource(kind);
      notifySourceChanged();

      // Reset before re-assigning: a stale src plus load() is its own source of
      // hangs, and `src = ""` would make the browser fetch the HTML document
      // and try to decode it as audio. load() also rejects any play() still
      // pending from the previous start with AbortError — which that start's
      // catch below recognises as not its business.
      audio.removeAttribute("src");
      audio.load();
      // Back up from whatever primeEpisode left it at — we want this one.
      audio.preload = "metadata";
      audio.src = url;
      const startAt = startPositionFor(episode.playbackPosition, episode.duration);
      seekEngine(startAt);
      audio.playbackRate = usePlayerStore.getState().playbackRate;

      armListen(episode, audio, startAt);

      try {
        // play() first, resumeContext() after. The analyser context is not
        // required for playback (see engine.ts) and awaiting it here put a
        // real task boundary between the user's tap and play(), which is how
        // Safari decides a call was not user-initiated.
        await audio.play();
        // Whatever happened, it happened to a show the listener has since
        // replaced. Its success is not ours to announce or count.
        if (!isCurrentStart(id)) return;
        resumeContext().catch(() => {});
        setPlaying(true);

        // Count the listen, unless this is a retry of one just counted.
        countListen(episode, id);
      } catch (err) {
        // A superseded start's rejection belongs to nobody (HD-003): charged to
        // the watchdog it lands on whatever is loading *now*. An AbortError is
        // a load() or pause() interrupting play() — the listener changing
        // course, not the stream failing.
        if (!isCurrentStart(id)) return;
        if (isAbortError(err)) return;
        // The element has moved on from the source this play() was for — a
        // failover to the mirror, or the watchdog's retry. Its rejection is the
        // old source's, already handled by whatever moved it.
        if (audio.src !== new URL(url, window.location.href).href) return;
        console.error("[player] Playback failed:", err);
        // Hand it to the watchdog, which owns the one-retry-then-fail policy.
        // Only fall back to the banner if there was no attempt to hand it to.
        //
        // The object URL is NOT revoked here. The watchdog's retry re-assigns
        // it, and revoking it first guaranteed the retry could not work
        // (HD-033). The store owns it and revokes it when a new source
        // replaces it or playback stops.
        if (isWatching()) {
          noteError("play-rejected");
        } else {
          usePlayerStore.getState().setLoadState("failed");
          setError("Playback failed. The audio source may be unavailable.");
        }
      }
    },
    [getAudio, setPlaying, setError],
  );

  /**
   * Pause, unconditionally. MediaSession's `pause` action calls this directly:
   * routing it through togglePlay() inverted it whenever the store and the
   * element disagreed — a lock-screen pause that started the show (HD-032).
   */
  const pausePlayback = useCallback(() => {
    const audio = getAudio();
    audio.pause();
    // Paused before the load settled: the listener changed their mind, and a
    // deadline that later fires over a paused element would raise a failure
    // dialog about a show nobody is waiting for. Resuming re-arms it, because
    // this source's listen has not been counted yet.
    if (isWatching() && !isListenCounted()) disarmWatchdog();
    setPlaying(false);
    flushListenTime("pause");
    resumeContext().catch(() => {});
  }, [getAudio, setPlaying]);

  /** Play or resume, unconditionally. MediaSession's `play` action. */
  const resumePlayback = useCallback(async () => {
    const audio = getAudio();

    // No source, but an episode is loaded — this is the restored-episode case.
    // Route through the normal play path rather than dead-ending. Dispatching
    // is synchronous and the seeded fast path reaches play() without an
    // intervening task, so the user's gesture is still in hand.
    if (!audio.src) {
      const { currentEpisode: ep } = usePlayerStore.getState();
      if (ep) {
        emit("play-episode", ep);
      }
      return;
    }

    const { currentEpisode: ep } = usePlayerStore.getState();
    const id = currentStart();

    // The first play of this source — a primed restored episode, or one paused
    // before its load settled. It needs the same watchdog cover as a fresh
    // start, and it is a *listen starting*, which must be counted: this branch
    // never touches playEpisode.
    //
    // Decided by the counted-listen flag, not by readyState. A seek while
    // paused drops readyState below HAVE_FUTURE_DATA, so the old test counted
    // pause-scrub-resume as a brand new listen (HD-024).
    const firstPlay = !isListenCounted() && !isWatching();

    // A restored show was primed with its archive.org URL. If archive.org has
    // gone down since, send this first play where the start plan says — the
    // mirror, or the outage dialog for a show the mirror does not hold —
    // exactly as a fresh start from the library would be (both start paths).
    if (firstPlay && ep && usePlayerStore.getState().source === "archive" && archiveKnownDown()) {
      if (refuseIfUnavailable(ep)) return;
      const plan = currentStartPlan(ep);
      if (plan.kind === "play" && plan.source.kind === "mirror") {
        audio.src = plan.source.url;
        usePlayerStore.getState().setSource("mirror");
        notifySourceChanged();
        seekEngine(startPositionFor(ep.playbackPosition, ep.duration));
      }
    }

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
      if (!isCurrentStart(id)) return;
      resumeContext().catch(() => {});
      setPlaying(true);
      if (firstPlay && ep) countListen(ep, id);
    } catch (err) {
      if (!isCurrentStart(id)) return;
      if (isAbortError(err)) return;
      console.error("[player] Play failed:", err);
      // This catch used to swallow the rejection entirely, so a refused
      // resume left the UI paused with no explanation whatsoever.
      if (isWatching()) {
        noteError("play-rejected");
      } else {
        setError("Couldn't resume playback. Try again.");
      }
    }
  }, [getAudio, setPlaying, setError]);

  // Play/pause toggle — the ▶/❚❚ button, whose label is the store's `playing`.
  const togglePlay = useCallback(async () => {
    if (usePlayerStore.getState().playing) pausePlayback();
    else await resumePlayback();
  }, [pausePlayback, resumePlayback]);

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
          // A new object, not a write into the one the store holds: mutating
          // it in place changed state without a set(), so nothing subscribed
          // to currentEpisode could see it (HD-032).
          usePlayerStore.getState().patchCurrentEpisode({ playbackPosition: clamped });
          setPosition(clamped);
        }
        return;
      }
      // At readyState 0 the engine holds the seek until loadedmetadata.
      setPosition(seekEngine(seconds));
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
    // A press of Next is a request to move on, including in repeat-one,
    // where next() on its own hands back the same track (HD-024).
    const nextEp = state.next({ manual: true });
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
        seekEngine(0);
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
    return withGlobals("position-timer", () => {
      const start = () => {
        if (positionTimerRef.current) return;
        positionTimerRef.current = window.setInterval(() => {
          const audio = getMediaElement();
          if (audio && !audio.paused) {
            usePlayerStore.getState().setPosition(audio.currentTime);
            noteListenTick(audio.currentTime);
          }
        }, 250);
      };
      const stopTimer = () => {
        window.clearInterval(positionTimerRef.current);
        positionTimerRef.current = 0;
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
    });
  }, []);

  // Listen for audio ended + errors. Installed once — see withGlobals.
  useEffect(() => {
    const audio = getAudio();
    return withGlobals("media-events", () => {

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
        noteUnplayable(
          "empty-media",
          `ended duration=${Number.isFinite(audio.duration) ? audio.duration.toFixed(3) : String(audio.duration)}`,
        );
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

      // The show is finished: next time it starts from the top. Without this
      // the saved position sat in the last few seconds, so replaying a finished
      // show ended it again at once and the queue moved on — "the show didn't
      // start" (HD-004). Store first, so neither the pause save nor the pagehide
      // flush can write the old position back over it.
      const finished = state.currentEpisode;
      state.setPosition(0);
      if (finished?.id) {
        state.patchCurrentEpisode({ playbackPosition: 0 });
        db.episodes
          .update(finished.id, { playbackPosition: 0, updatedAt: Date.now() })
          .catch((err) => {
            console.warn("[player] Failed to clear finished position:", err);
          });
      }

      // Repeat one: just replay current track
      if (state.repeat === "one") {
        seekEngine(0);
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

      // Advisory. For a VBR rip with no Xing header — most of this catalog —
      // `duration` here is extrapolated from the first frame and browsers
      // correct it later, so this number is a guess. A guess must not be able to
      // stop an episode that plays perfectly well: a false stop costs a listener
      // a show, while letting a genuinely empty file run costs a few seconds
      // before `ended` catches it. `ended` keeps sole authority to fail.
      //
      // Recorded rather than dropped, so the question "how many working shows
      // would the five-second floor have eaten" has an answer from real traffic
      // rather than from argument.
      const ep = usePlayerStore.getState().currentEpisode;
      if (
        assessDuration({
          actual: audio.duration,
          expected: ep?.duration ?? null,
          stage: "metadata",
        }) !== "ok"
      ) {
        noteSuspectDuration(ep ? communityKey(ep) : null, audio.duration);
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
        // Carry what the element actually said. On Chromium a file with no
        // decodable frames errors here rather than reporting a short duration,
        // so `empty-media-suspected` can never fire on that engine — the
        // `MediaError` message ("DEMUXER_ERROR_COULD_NOT_OPEN: …") is the only
        // thing that distinguishes an empty file from an unreachable one.
        noteError(
          code === 3 ? "decode-error" : "network-error",
          describeMediaError(audio.error),
        );
      } else if (
        (code === 2 || code === 4) &&
        usePlayerStore.getState().source === "archive" &&
        usePlayerStore.getState().currentEpisode
      ) {
        // Mid-show, archive.org stopped delivering (the outage arriving while
        // someone listens). Supervise a fresh attempt from here, with the
        // mirror as its fallback, and report the error into it: failover takes
        // it from there, and the dialog if that fails too.
        const ep = usePlayerStore.getState().currentEpisode!;
        armListen(ep, audio, audio.currentTime);
        noteError("network-error", describeMediaError(audio.error));
      } else {
        const messages: Record<number, string> = {
          1: "Playback aborted.",
          2: "Network error. Check your connection.",
          3: "Audio decoding failed.",
          4: "Audio source not supported or unavailable.",
        };
        setError(messages[code ?? 0] ?? "An unknown playback error occurred.");
      }

      // On network/source errors, check if archive.org itself is down. A
      // verdict is published to the outage store, which is what turns on the
      // banner, the row marks and the fast fail (useOutageMonitor keeps it
      // current after that).
      if (code === 2 || code === 4) void checkArchiveHealth();
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
    // `abort` is not an error. It means the fetch stopped "not due to an
    // error" — in practice because load() or a new src replaced it. The event
    // is queued, so when one show replaces another it arrives *after* the new
    // start has armed the watchdog; reporting it charged the new show with a
    // network error and spent its retry tearing down a healthy load. The same
    // phantom as HD-003, by a different route.
    const onAbort = () => {
      setBuffering(false);
    };

    // Tell the watchdog it has eyes. Without this it refuses to arm, which is
    // the only thing standing between "supervising playback" and "reporting
    // timeouts it has no way to observe" — the state this file shipped in.
    noteListenersAttached();

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
      noteListenersDetached();
    };
    });
  }, [getAudio, setPlaying, setDuration, setError]);

  // The watchdog reports terminal failures here — the retry is already spent,
  // so this is what raises the modal.
  useEffect(() => {
    return withGlobals("failure-handler", () => {
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

  // The archive.org outage path: the watchdog decided archive.org has stopped
  // delivering and hands over the next host (the mirror). Same element — on
  // iOS the one that was allowed to play is the one likeliest to be allowed
  // again — same position, resumed if it was playing. The listen is counted
  // here only if it had not been yet: a failover mid-load interrupts the first
  // play() with an AbortError before it could count, and a failover mid-show
  // is the same listen continuing.
  useEffect(() => {
    return withGlobals("failover-handler", () => {
      setFailoverHandler(async (next, { position, wanted }) => {
        const audio = getAudio();
        const store = usePlayerStore.getState();
        const ep = store.currentEpisode;
        const id = currentStart();
        store.setSource(next.kind);
        audio.removeAttribute("src");
        audio.load();
        audio.preload = "metadata";
        audio.src = next.url;
        seekEngine(position);
        audio.playbackRate = store.playbackRate;
        if (!wanted) return true;
        try {
          await audio.play();
        } catch (err) {
          // Superseded (the listener picked something else) is not a refusal.
          if (!isCurrentStart(id) || isAbortError(err)) return true;
          return false;
        }
        if (!isCurrentStart(id)) return true;
        setPlaying(true);
        resumeContext().catch(() => {});
        if (ep && !isListenCounted()) countListen(ep, id);
        return true;
      });
      return () => setFailoverHandler(null);
    });
  }, [getAudio, setPlaying]);

  // Persist playback position: every POSITION_SAVE_MS while playing, and at
  // once on pause. Mount-once for the same reason as the position timer —
  // otherwise both instances wrote the same row on every interval.
  useEffect(() => {
    return withGlobals("persist-position", () => {
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
    });
  }, []);

  // Flush position + listen time on page unload
  useEffect(() => {
    return withGlobals("unload-flush", () => {
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
    pausePlayback,
    resumePlayback,
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
