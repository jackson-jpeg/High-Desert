// What starting (and ending) a listen means, for useAudioPlayer.
//
// Not to be confused with src/audio/play-session.ts, which owns the start
// generation token this module consumes. That one answers "is this start still
// the current one"; this one is the side effects of a start: queue context,
// watchdog cover, the play report, and the watchdog's two hand-backs (terminal
// failure, failover to the mirror).

import { usePlayerStore } from "@/stores/player-store";
import { liveLocked } from "@/stores/live-store";
import { resumeContext, seekEngine } from "@/audio/engine";
import {
  currentStart,
  isAbortError,
  isCurrentStart,
  isListenCounted,
  markListenCounted,
} from "@/audio/play-session";
import { db } from "@/db";
import { writeProgress } from "@/services/episodes/progress";
import type { Episode } from "@/db/schema";
import { reportPlay, reportStop } from "@/services/stats/client";
import { SESSION_ID } from "@/lib/utils/session-id";
import { communityKey } from "@/lib/utils/community-key";
import { fallbacksFor } from "@/audio/sources";
import { claimLiveListen } from "@/audio/live-session";
import {
  armWatchdog,
  setFailureHandler,
  setFailoverHandler,
} from "@/audio/playback-watchdog";

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
export const PLAYER_SESSION_ID = SESSION_ID;

/**
 * @param reason `pause` keeps the session marked as listening — a brief pause
 * is not leaving. `ended`/`stop`/`unload` clear it.
 */
export function flushListenTime(reason: "pause" | "ended" | "unload" | "stop") {
  if (reason === "ended" || reason === "unload" || reason === "stop") {
    reportStop(PLAYER_SESSION_ID);
  }
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
export function openListen(episode: Episode, objectUrl: string): void {
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
export function armListen(
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
export function countListen(episode: Episode, start: number): void {
  // This source's listen is counted, whatever the de-duplication below decides:
  // a pause/seek/resume of it is the same listen continuing.
  markListenCounted(start);
  // A live airing counts once per client, however many times it is tuned in
  // to: re-tuning to the same show an hour in is still the one listen. The
  // next show is a new airing and counts once too (src/audio/live-session.ts).
  if (claimLiveListen(episode) === false) return;
  const key = communityKey(episode);
  if (!shouldCountPlay(key ?? `local:${episode.fileHash}`)) return;

  if (key) reportPlay(key, PLAYER_SESSION_ID, usePlayerStore.getState().source);
  if (episode.id) {
    const now = Date.now();
    // The play count is the episode's (once per listen); when it was last
    // played is progress, which the position saves keep current (HD-016).
    db.episodes
      .update(episode.id, {
        playCount: (episode.playCount ?? 0) + 1,
        updatedAt: now,
      })
      .catch((err) => {
        console.warn("[player] Failed to update play count:", err);
      });
    writeProgress(episode.fileHash, { lastPlayedAt: now }).catch((err) => {
      console.warn("[player] Failed to record last played:", err);
    });
  }
}

// ── The watchdog's hand-backs ──

/**
 * The watchdog reports terminal failures here — the retry is already spent, so
 * this is what raises the modal. Installed once, under the "failure-handler" key.
 */
export function installFailureHandler(setPlaying: (p: boolean) => void): () => void {
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
}

/**
 * The archive.org outage path: the watchdog decided archive.org has stopped
 * delivering and hands over the next host (the mirror). Same element — on iOS
 * the one that was allowed to play is the one likeliest to be allowed again —
 * same position, resumed if it was playing. The listen is counted here only if
 * it had not been yet: a failover mid-load interrupts the first play() with an
 * AbortError before it could count, and a failover mid-show is the same listen
 * continuing. Installed once, under the "failover-handler" key.
 */
export function installFailoverHandler(
  getAudio: () => HTMLAudioElement,
  setPlaying: (p: boolean) => void,
): () => void {
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
    audio.playbackRate = liveLocked() ? 1 : store.playbackRate;
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
}
