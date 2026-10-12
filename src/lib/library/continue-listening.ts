import type { Episode, Progress } from "@/db/schema";
import { startPositionFor } from "@/audio/play-session";
import { isRemovedFromCatalog } from "@/lib/library/removed-episodes";

/**
 * Which shows "Continue listening" offers (the Library's top, and the
 * welcome page): shows this browser stopped part way through, newest first.
 *
 * "Part way" is the play path's own rule, not a second one: a show resumes
 * where `startPositionFor()` would start it, so a show that rule calls
 * finished (within 30 s of the end, or past 95%) is not offered, and one it
 * would resume is. Under a minute in is a sample, not a listen, and is left
 * out. Pulled shows (REMOVED_FROM_CATALOG) are never offered: a tap would only
 * raise the "no longer in the archive" dialog.
 */

/** Less than this far in is not worth a card. */
export const CONTINUE_MIN_SECONDS = 60;

/** At most this many: one featured, and a short row beside it. */
export const CONTINUE_LIMIT = 3;

export interface ContinueItem {
  episode: Episode;
  /** Where play resumes, seconds. */
  position: number;
  /** Seconds left, when the length is known. */
  remaining: number | null;
  /** 0 to 100, when the length is known. */
  percent: number | null;
}

export function continueItems(
  played: readonly { episode: Episode; progress: Progress }[],
  { exclude = null, limit = CONTINUE_LIMIT }: { exclude?: string | null; limit?: number } = {},
): ContinueItem[] {
  const out: ContinueItem[] = [];
  for (const { episode, progress } of played) {
    if (out.length >= limit) break;
    if (exclude && episode.fileHash === exclude) continue;
    if (isRemovedFromCatalog(episode)) continue;
    const position = startPositionFor(progress.playbackPosition, episode.duration);
    if (position < CONTINUE_MIN_SECONDS) continue;
    const length = typeof episode.duration === "number" && episode.duration > 0 ? episode.duration : null;
    out.push({
      episode,
      position,
      remaining: length ? Math.max(0, length - position) : null,
      percent: length ? Math.min(100, Math.round((position / length) * 100)) : null,
    });
  }
  return out;
}

/** "1 h 12 min left", "38 min left", "under a minute left". */
export function remainingLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.round(seconds / 60);
  if (m < 1) return "under a minute left";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min left` : `${m} min left`;
}
