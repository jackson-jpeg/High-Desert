import type { Episode } from "@/db/schema";
import { planStart, type StartPlan } from "@/audio/sources";
import { archiveKnownDown, checkArchiveHealth } from "@/services/archive/health";
import { useOutageStore } from "@/stores/outage-store";

/**
 * The start plan against what the app knows right now: the published health
 * verdict and the mirror's manifest. Synchronous — the play path calls it
 * between the tap and `play()`.
 */
export function currentStartPlan(episode: Pick<Episode, "fileHash" | "sourceUrl">): StartPlan {
  return planStart(episode, {
    archiveDown: archiveKnownDown(),
    playable: useOutageStore.getState().manifest?.fileHashes ?? null,
  });
}

/**
 * Refuse a start that cannot work — archive.org is down and the mirror does
 * not hold the show — and say so at once, with shows that will play instead.
 * Returns true when refused; the caller must then touch nothing: not the
 * element (whatever is playing keeps playing), not the queue, not the stats.
 *
 * Every start path calls this before anything else: the play-episode handler,
 * `playEpisode()` (queue advance, radio) and the first ▶ of a restored show.
 *
 * It also asks for a fresh verdict in the background. If archive.org has come
 * back since the last probe, the store flips to up, which closes the dialog
 * and clears the dimming; the listener's next tap then goes to archive.org.
 */
export function refuseIfUnavailable(episode: Episode): boolean {
  if (currentStartPlan(episode).kind !== "unavailable") return false;
  useOutageStore.getState().showUnavailable(episode);
  void checkArchiveHealth();
  return true;
}

/**
 * The play-episode handler's front door: a requested start is queued only if
 * it can happen. A refused show must not land in the queue, where the next
 * advance would only refuse it again. Only streamed episodes are gated; a
 * local file never needed archive.org. Returns false when refused.
 */
export function admitRequestedStart(episode: Episode, enqueue: (episode: Episode) => void): boolean {
  if (episode.sourceUrl && refuseIfUnavailable(episode)) return false;
  enqueue(episode);
  return true;
}
