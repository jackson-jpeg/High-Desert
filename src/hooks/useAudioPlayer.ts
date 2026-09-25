"use client";

// The player hook. Mounted twice — by (desktop)/layout.tsx and by AudioPlayer —
// and both instances drive the one element the engine owns.
//
// This file holds the start/stop/seek surface and wires the rest together. The
// rest lives beside it in ./player/:
//
//   globals.ts        withGlobals(key, install) — one install per key, however
//                     many instances are mounted. READ IT before adding an effect
//                     with a side effect outside React.
//   play-session.ts   what starting a listen means (openListen / armListen /
//                     countListen) and the watchdog's failure/failover hand-backs
//   media-events.ts   the media element's listeners — the watchdog's eyes
//   persistence.ts    the position tick, position saves, the unload flush
//   media-session.ts  lock screen / headset controls

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { positionOf, useProgressStore } from "@/stores/progress-store";
import {
  initEngine,
  setEngineVolume,
  resumeContext,
  getMediaElement,
  seekEngine,
} from "@/audio/engine";
import {
  beginStart,
  currentStart,
  isAbortError,
  isCurrentStart,
  isListenCounted,
  startPositionFor,
} from "@/audio/play-session";
import type { Episode } from "@/db/schema";
import { isRemovedFromCatalog } from "@/lib/library/removed-episodes";
import { archiveKnownDown } from "@/services/archive/health";
import type { SourceKind } from "@/audio/sources";
import { currentStartPlan, refuseIfUnavailable } from "@/audio/outage-gate";
import { disarmWatchdog, isWatching, noteError } from "@/audio/playback-watchdog";
import { emit } from "@/lib/events";
import { withGlobals } from "./player/globals";
import {
  armListen,
  countListen,
  flushListenTime,
  installFailoverHandler,
  installFailureHandler,
  openListen,
} from "./player/play-session";
import { installMediaEvents } from "./player/media-events";
import {
  installPositionPersistence,
  installPositionTimer,
  installUnloadFlush,
} from "./player/persistence";
import { useMediaSession } from "./player/media-session";

export { POSITION_SAVE_MS } from "./player/persistence";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      // A pulled episode is never given a source: ▶ then finds no src and goes
      // through play-episode, which explains instead (removed-episodes.ts).
      if (isRemovedFromCatalog(episode)) return;
      const audio = getAudio();
      if (audio.src) return; // something is already loaded; don't stomp it
      // A new source is a new start: its listen has not been counted.
      beginStart();
      audio.preload = "none";
      audio.src = episode.sourceUrl;
      usePlayerStore.getState().setSource("archive");
      // readyState is 0 here, so this is held until loadedmetadata (engine.ts).
      seekEngine(startPositionFor(positionOf(episode.fileHash), episode.duration));
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

      // Pulled from the catalog: its archive.org file has no audio in it.
      // Say so, and touch nothing — no source, no request to archive.org, and
      // whatever is playing now keeps playing. Every start comes through here
      // (library, queue advance, radio), so this is the one guard that matters.
      if (isRemovedFromCatalog(episode)) {
        emit("episode-unavailable", episode);
        return;
      }

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
      const startAt = startPositionFor(positionOf(episode.fileHash), episode.duration);
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
        seekEngine(startPositionFor(positionOf(ep.fileHash), ep.duration));
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
      // playEpisode seeks to the saved position when it loads. In memory, as
      // it always was: the progress mirror (HD-016), not the database.
      if (!audio.src) {
        const { currentEpisode: ep, duration: storeDuration } =
          usePlayerStore.getState();
        if (ep && storeDuration > 0) {
          const clamped = Math.max(0, Math.min(seconds, storeDuration));
          // A new entry, not a write into the one the store holds: mutating
          // it in place changed state without a set(), so nothing subscribed
          // could see it (HD-032).
          useProgressStore.getState().patch(ep.fileHash, { playbackPosition: clamped });
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

  // Each install below runs once however many instances are mounted, and each
  // has its OWN key — see ./player/globals.ts for what a shared one cost.

  // The 250 ms position tick (store position + listened time).
  useEffect(() => withGlobals("position-timer", installPositionTimer), []);

  // Listen for audio ended + errors — the watchdog's eyes.
  useEffect(() => {
    const audio = getAudio();
    return withGlobals("media-events", () =>
      installMediaEvents(audio, { setPlaying, setDuration, setError }),
    );
  }, [getAudio, setPlaying, setDuration, setError]);

  // The watchdog's terminal failures raise the modal here.
  useEffect(
    () => withGlobals("failure-handler", () => installFailureHandler(setPlaying)),
    [setPlaying],
  );

  // The watchdog's failover to the mirror.
  useEffect(
    () => withGlobals("failover-handler", () => installFailoverHandler(getAudio, setPlaying)),
    [getAudio, setPlaying],
  );

  // Persist playback position: periodically while playing, and on pause.
  useEffect(() => withGlobals("persist-position", installPositionPersistence), []);

  // Flush position + listen time on page unload.
  useEffect(() => withGlobals("unload-flush", installUnloadFlush), []);

  useMediaSession({
    currentEpisode,
    playing,
    resumePlayback,
    pausePlayback,
    playNext,
    playPrevious,
    seek,
  });

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
