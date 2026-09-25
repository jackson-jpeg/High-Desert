// The media element's listeners, for useAudioPlayer. Installed once, under the
// "media-events" GlobalKey (./globals.ts) — the hook is mounted twice and two
// `ended` handlers advanced the queue by two.
//
// These listeners are the watchdog's only eyes. For four months they were never
// attached (docs/phantom-failures.md), and the watchdog timed out every load it
// could not see. noteListenersAttached()/noteListenersDetached() bracket the
// install so that armWatchdog() refuses to supervise blind.

import { usePlayerStore } from "@/stores/player-store";
import { seekEngine } from "@/audio/engine";
import { db } from "@/db";
import { communityKey } from "@/lib/utils/community-key";
import { checkArchiveHealth } from "@/services/archive/health";
import {
  describeMediaError,
  isWatching,
  noteError,
  noteListenersAttached,
  noteListenersDetached,
  noteProgress,
  noteReady,
  noteSuspectDuration,
  noteUnplayable,
  noteWaiting,
} from "@/audio/playback-watchdog";
import { assessDuration } from "@/audio/duration-sanity";
import { armListen, flushListenTime } from "./play-session";

export interface MediaEventActions {
  setPlaying: (p: boolean) => void;
  setDuration: (d: number) => void;
  setError: (e: string | null) => void;
}

export function installMediaEvents(
  audio: HTMLAudioElement,
  { setPlaying, setDuration, setError }: MediaEventActions,
): () => void {
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
}
