import type { HistoryEntry } from "@/db/schema";
import { computeStreak } from "@/lib/utils/streak";

// What counts as a listen, for every surface that shows one (UI plan push 6,
// batch 2). Pure: no database. The writer is src/services/episodes/history.ts.

/**
 * Heard for at least this long, a row is a listen. Below it, a show was put
 * on and left: it is not a play in the history, a day in the streak or a show
 * in "heard". One number for every surface, so they agree.
 */
export const LISTEN_MIN_S = 60;

/**
 * The rows that are real listens. Rows written before 2026-11-27 by a page
 * load carry 0 s and drop out here: nobody heard them, and the seconds of the
 * listens that were heard with the screen locked were never measured, so
 * there is nothing true to show for them.
 */
export function realListens<T extends Pick<HistoryEntry, "duration">>(rows: readonly T[] | undefined): T[] {
  return (rows ?? []).filter((r) => (r.duration ?? 0) >= LISTEN_MIN_S);
}

export interface ListenGroup {
  episodeId: number;
  episodeTitle?: string;
  guestName?: string;
  /** The newest listen. */
  last: number;
  /** Listens of this show (one row per show per day, or per return to it). */
  plays: number;
  /** Seconds heard across them. */
  seconds: number;
}

/**
 * Listening History for display: one line per show, newest first, with how
 * many times it was played ("played 5 times") and the time heard. Only real
 * listens count.
 */
export function groupListens(rows: readonly HistoryEntry[] | undefined): ListenGroup[] {
  const by = new Map<number, ListenGroup>();
  for (const r of realListens(rows)) {
    const g = by.get(r.episodeId);
    if (g) {
      g.plays += 1;
      g.seconds += r.duration;
      if (r.timestamp > g.last) {
        g.last = r.timestamp;
        g.episodeTitle = r.episodeTitle ?? g.episodeTitle;
        g.guestName = r.guestName ?? g.guestName;
      }
    } else {
      by.set(r.episodeId, {
        episodeId: r.episodeId,
        episodeTitle: r.episodeTitle,
        guestName: r.guestName,
        last: r.timestamp,
        plays: 1,
        seconds: r.duration,
      });
    }
  }
  return [...by.values()].sort((a, b) => b.last - a.last);
}

/**
 * The listening streak, from real listens: the Streak tile on /stats and the
 * status bar's streak are this one function, so they cannot disagree.
 */
export function listeningStreak(rows: readonly Pick<HistoryEntry, "duration" | "timestamp">[] | undefined, now?: Date): number {
  return computeStreak(realListens(rows), now);
}
